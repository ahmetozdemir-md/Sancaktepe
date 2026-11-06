export const PLANNER_CHANNEL = 'nobet-planner-v1';
const ACTIONS = new Set(['load', 'save', 'backups', 'backup', 'publish']);

/** The authenticated portal owns storage; this frame receives no session tokens. */
export function createPlannerBridge(target, { timeoutMs = 30_000 } = {}) {
  const pending = new Map();
  let counter = 0;
  let previousStatus = '';
  const prefix = target.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  const origin = target.location.origin;
  const onMessage = event => {
    if (event.source !== target.parent || event.origin !== origin) return;
    const message = event.data;
    if (!message || message.channel !== PLANNER_CHANNEL || message.type !== 'response'
      || typeof message.id !== 'string' || typeof message.ok !== 'boolean') return;
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    clearTimeout(call.timer);
    if (message.ok) call.resolve(message.data);
    else {
      const error = new Error(typeof message.error === 'string' ? message.error : 'İşlem tamamlanamadı.');
      error.status = Number.isInteger(message.status) ? message.status : 500;
      call.reject(error);
    }
  };
  target.addEventListener('message', onMessage);
  const request = (action, payload = {}, options = {}) => new Promise((resolve, reject) => {
    if (!ACTIONS.has(action)) { reject(new Error('Desteklenmeyen planlayıcı işlemi.')); return; }
    if (target.parent === target) {
      reject(new Error('Nöbet planlayıcıyı Asistan sistemindeki “Nöbet listesi yap” düğmesinden açın.'));
      return;
    }
    const id = `${prefix}:${++counter}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      const error = new Error('Asistan sistemi yanıt vermedi. Bağlantını kontrol edip yeniden dene.');
      error.status = 504;
      reject(error);
    }, options.timeoutMs ?? timeoutMs);
    pending.set(id, { resolve, reject, timer });
    try { target.parent.postMessage({ channel: PLANNER_CHANNEL, type: 'request', id, action, payload }, origin); }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
  const destroy = () => {
    target.removeEventListener('message', onMessage);
    for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error('Planlayıcı kapatıldı.')); }
    pending.clear();
  };
  const notifyStatus = ({ dirty, busy, month }) => {
    if (target.parent === target) return;
    const message = { channel: PLANNER_CHANNEL, type: 'status', dirty: !!dirty, busy: !!busy, month };
    const serialized = JSON.stringify(message);
    if (serialized === previousStatus) return;
    previousStatus = serialized;
    target.parent.postMessage(message, origin);
  };
  return { request, destroy, notifyStatus };
}

/** Preserve the planner's existing optimistic revision/save handling. */
export function createPlannerFetch(bridge) {
  return async function plannerFetch(path, options = {}) {
    let action, payload = {};
    if (path === '/api/state' && (!options.method || options.method === 'GET')) action = 'load';
    else if (path === '/api/state' && options.method === 'PUT') { action = 'save'; payload = JSON.parse(options.body); }
    else if (path === '/api/backups' && (!options.method || options.method === 'GET')) action = 'backups';
    else if (path.startsWith('/api/backups/') && (!options.method || options.method === 'GET')) {
      action = 'backup'; payload = { id: decodeURIComponent(path.slice('/api/backups/'.length)) };
    } else throw new Error('Desteklenmeyen planlayıcı adresi.');
    try {
      const result = await bridge.request(action, payload);
      return { ok: true, status: 200, json: async () => result };
    } catch (error) {
      return { ok: false, status: error.status ?? 500, json: async () => ({ error: error.message }) };
    }
  };
}

export const plannerBridge = typeof window === 'undefined' ? null : createPlannerBridge(window);
export const plannerFetch = plannerBridge ? createPlannerFetch(plannerBridge) : null;
