import { createClient } from 'npm:@supabase/supabase-js@2.105.1'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from 'npm:@simplewebauthn/server@13.3.2'

const RP_NAME = 'Asistan Sistemi'
const RP_ID = Deno.env.get('ASSISTANT_PASSKEY_RP_ID') ?? 'sancaktepe-kappa.vercel.app'
const ALLOWED_ORIGINS = (
  Deno.env.get('ASSISTANT_PASSKEY_ORIGINS') ??
  'https://sancaktepe-kappa.vercel.app'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const supabaseUrl = Deno.env.get('SUPABASE_URL')
const serviceRoleKey =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY')

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Supabase service configuration is missing')
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

type PasskeyAction =
  | 'register-options'
  | 'register-verify'
  | 'authentication-options'
  | 'authentication-verify'

interface PasskeyRequestBody {
  action?: PasskeyAction
  accessToken?: string
  challengeId?: string
  response?: RegistrationResponseJSON | AuthenticationResponseJSON
}

interface PasskeyCredentialRow {
  credential_id: string
  public_key: string
  counter: number | string
  transports: AuthenticatorTransportFuture[] | null
  device_type: string | null
  backed_up: boolean
  password_version: number | string
}

interface PasskeyChallengeRow {
  id: string
  challenge: string
  ceremony: 'register' | 'authenticate'
  access_token_hash: string | null
  origin: string
  rp_id: string
  expires_at: string
  used_at: string | null
}

function corsHeaders(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function jsonResponse(origin: string, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function currentPasswordVersion(): Promise<number> {
  const { data, error } = await admin
    .from('assistant_access_config')
    .select('password_version')
    .eq('id', 1)
    .single()

  if (error || !data) {
    throw new Error('Assistant access configuration is unavailable')
  }

  return Number(data.password_version)
}

async function validateAccessToken(accessToken: string): Promise<{
  tokenHash: string
  passwordVersion: number
}> {
  if (!/^[0-9a-f]{64}$/u.test(accessToken)) {
    throw new Error('invalid-access-token')
  }

  const tokenHash = await sha256Hex(accessToken)
  const passwordVersion = await currentPasswordVersion()
  const { data, error } = await admin
    .from('assistant_access_sessions')
    .select('password_version')
    .eq('token_hash', tokenHash)
    .eq('password_version', passwordVersion)
    .maybeSingle()

  if (error || !data) {
    throw new Error('invalid-access-token')
  }

  return { tokenHash, passwordVersion }
}

async function storeChallenge(input: {
  challenge: string
  ceremony: 'register' | 'authenticate'
  origin: string
  accessTokenHash?: string
}): Promise<string> {
  const { data, error } = await admin
    .from('assistant_passkey_challenges')
    .insert({
      challenge: input.challenge,
      ceremony: input.ceremony,
      access_token_hash: input.accessTokenHash ?? null,
      origin: input.origin,
      rp_id: RP_ID,
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error('challenge-store-failed')
  }

  return String(data.id)
}

async function consumeChallenge(
  challengeId: string,
  ceremony: 'register' | 'authenticate',
): Promise<PasskeyChallengeRow> {
  if (!/^[0-9a-f-]{36}$/iu.test(challengeId)) {
    throw new Error('invalid-challenge')
  }

  const { data, error } = await admin
    .from('assistant_passkey_challenges')
    .update({ used_at: new Date().toISOString() })
    .eq('id', challengeId)
    .eq('ceremony', ceremony)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('*')
    .maybeSingle()

  if (error || !data) {
    throw new Error('challenge-expired')
  }

  return data as PasskeyChallengeRow
}

async function pruneChallenges() {
  await admin
    .from('assistant_passkey_challenges')
    .delete()
    .lt('expires_at', new Date().toISOString())
}

async function createRegistrationOptions(origin: string, accessToken: string) {
  const { tokenHash } = await validateAccessToken(accessToken)
  const { data: existingCredentials, error } = await admin
    .from('assistant_passkey_credentials')
    .select('credential_id, transports')

  if (error) {
    throw new Error('credential-read-failed')
  }

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: `assistant-device-${crypto.randomUUID()}`,
    userDisplayName: 'Asistan Sistemi Cihazı',
    attestationType: 'none',
    supportedAlgorithmIDs: [-7, -257],
    excludeCredentials: (existingCredentials ?? []).map((credential) => ({
      id: String(credential.credential_id),
      transports: (credential.transports ?? []) as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
    preferredAuthenticatorType: 'localDevice',
  })

  const challengeId = await storeChallenge({
    challenge: options.challenge,
    ceremony: 'register',
    origin,
    accessTokenHash: tokenHash,
  })

  return { options, challengeId }
}

async function verifyRegistration(
  origin: string,
  accessToken: string,
  challengeId: string,
  response: RegistrationResponseJSON,
) {
  const { tokenHash, passwordVersion } = await validateAccessToken(accessToken)
  // Claim the one-time challenge before verification to prevent concurrent replays.
  const challenge = await consumeChallenge(challengeId, 'register')

  if (challenge.origin !== origin || challenge.access_token_hash !== tokenHash) {
    throw new Error('challenge-mismatch')
  }

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: challenge.origin,
    expectedRPID: challenge.rp_id,
    requireUserVerification: true,
  })

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('registration-verification-failed')
  }

  const {
    credential,
    credentialDeviceType,
    credentialBackedUp,
  } = verification.registrationInfo

  const { error } = await admin
    .from('assistant_passkey_credentials')
    .upsert({
      credential_id: credential.id,
      public_key: bytesToBase64Url(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? [],
      device_type: credentialDeviceType,
      backed_up: credentialBackedUp,
      password_version: passwordVersion,
      last_used_at: null,
    })

  if (error) {
    throw new Error('credential-store-failed')
  }

  return { verified: true }
}

async function createAuthenticationOptions(origin: string) {
  const passwordVersion = await currentPasswordVersion()
  const { data: credentials, error } = await admin
    .from('assistant_passkey_credentials')
    .select('credential_id, transports')
    .eq('password_version', passwordVersion)

  if (error) {
    throw new Error('credential-read-failed')
  }
  if (!credentials?.length) {
    throw new Error('no-passkeys')
  }

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'required',
    allowCredentials: credentials.map((credential) => ({
      id: String(credential.credential_id),
      transports: (credential.transports ?? []) as AuthenticatorTransportFuture[],
    })),
  })
  const challengeId = await storeChallenge({
    challenge: options.challenge,
    ceremony: 'authenticate',
    origin,
  })

  return { options, challengeId }
}

async function verifyAuthentication(
  origin: string,
  challengeId: string,
  response: AuthenticationResponseJSON,
) {
  // Claim the one-time challenge before verification to prevent concurrent replays.
  const challenge = await consumeChallenge(challengeId, 'authenticate')
  if (challenge.origin !== origin) {
    throw new Error('challenge-mismatch')
  }

  const passwordVersion = await currentPasswordVersion()
  const { data, error } = await admin
    .from('assistant_passkey_credentials')
    .select('*')
    .eq('credential_id', response.id)
    .eq('password_version', passwordVersion)
    .maybeSingle()

  if (error || !data) {
    throw new Error('credential-not-found')
  }

  const credential = data as PasskeyCredentialRow
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: challenge.origin,
    expectedRPID: challenge.rp_id,
    credential: {
      id: credential.credential_id,
      publicKey: base64UrlToBytes(credential.public_key),
      counter: Number(credential.counter),
      transports: credential.transports ?? [],
    },
    requireUserVerification: true,
  })

  if (!verification.verified) {
    throw new Error('authentication-verification-failed')
  }

  const accessToken = randomHex(32)
  const tokenHash = await sha256Hex(accessToken)
  const now = new Date().toISOString()
  const [{ error: credentialUpdateError }, { error: sessionError }] = await Promise.all([
    admin
      .from('assistant_passkey_credentials')
      .update({
        counter: verification.authenticationInfo.newCounter,
        last_used_at: now,
      })
      .eq('credential_id', credential.credential_id),
    admin.from('assistant_access_sessions').insert({
      token_hash: tokenHash,
      password_version: passwordVersion,
      expires_at: null,
      last_used_at: now,
    }),
  ])

  if (credentialUpdateError || sessionError) {
    throw new Error('session-store-failed')
  }

  return { verified: true, accessToken }
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin') ?? ''
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return new Response('Origin not allowed', { status: 403 })
  }

  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) })
  }
  if (request.method !== 'POST') {
    return jsonResponse(origin, { error: 'method-not-allowed' }, 405)
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0')
  if (contentLength > 131_072) {
    return jsonResponse(origin, { error: 'request-too-large' }, 413)
  }

  try {
    await pruneChallenges()
    const body = (await request.json()) as PasskeyRequestBody

    switch (body.action) {
      case 'register-options':
        if (!body.accessToken) {
          throw new Error('invalid-access-token')
        }
        return jsonResponse(origin, await createRegistrationOptions(origin, body.accessToken))

      case 'register-verify':
        if (
          !body.accessToken ||
          !body.challengeId ||
          !body.response
        ) {
          throw new Error('invalid-request')
        }
        return jsonResponse(
          origin,
          await verifyRegistration(
            origin,
            body.accessToken,
            body.challengeId,
            body.response as RegistrationResponseJSON,
          ),
        )

      case 'authentication-options':
        return jsonResponse(origin, await createAuthenticationOptions(origin))

      case 'authentication-verify':
        if (!body.challengeId || !body.response) {
          throw new Error('invalid-request')
        }
        return jsonResponse(
          origin,
          await verifyAuthentication(
            origin,
            body.challengeId,
            body.response as AuthenticationResponseJSON,
          ),
        )

      default:
        return jsonResponse(origin, { error: 'unknown-action' }, 400)
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : 'passkey-error'
    const knownClientErrors = new Set([
      'invalid-access-token',
      'invalid-challenge',
      'challenge-expired',
      'challenge-mismatch',
      'no-passkeys',
      'credential-not-found',
      'registration-verification-failed',
      'authentication-verification-failed',
      'invalid-request',
    ])
    console.error('assistant-passkey:', code)
    return jsonResponse(
      origin,
      { error: knownClientErrors.has(code) ? code : 'passkey-service-error' },
      knownClientErrors.has(code) ? 400 : 500,
    )
  }
})
