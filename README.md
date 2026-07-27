# Çalışma Listesi Portalı

Admin ve asistan hekim panelleri olan, haftalık çalışma planı ve aylık nöbet yönetimi için geliştirilmiş web uygulaması.

## Geliştirme

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Supabase

Online kayıt için `supabase/001_portal_state.sql` dosyasını Supabase SQL Editor'de çalıştır.
Otomatik/manüel yedek geçmişi için `supabase/002_portal_state_history.sql` dosyasının da çalışmış olması gerekir.

## Güvenli Admin Modu

Anon key tarayıcıda göründüğü için üretimde yazma yetkisini anon kullanıcıdan almak gerekir.
Bunun için sırasıyla:

1. Supabase Dashboard > Authentication > Users ekranından admin kullanıcı oluştur.
2. `supabase/003_auth_harden_portal_state.sql` dosyasını Supabase SQL Editor'de çalıştır.
3. Aynı dosyanın en altındaki `insert into public.portal_admins...` örneğini kendi admin e-postanla çalıştır.
4. Local ve Vercel ortam değişkenlerine `VITE_REQUIRE_SUPABASE_ADMIN_AUTH=true` ekle.
5. Redeploy sonrası admin girişi yerel admin şifresine ek olarak Supabase admin e-posta/şifresi ister.

Bu modda asistanlar listeyi okumaya devam eder; veri yazma, yedek alma ve yedekten dönme sadece yetkili Supabase admin oturumuyla yapılır.

## Asistan Giriş Şifresi

Ortak asistan şifresi ve hatırlanan cihaz doğrulaması için güvenli admin modu kurulduktan sonra
`supabase/005_assistant_access_password.sql` dosyasını Supabase SQL Editor'de çalıştır.

- İlk ortak şifre `sancaktepe` olarak yalnız kurulum sırasında bcrypt hash biçiminde oluşturulur.
- Gerçek şifre tarayıcıda veya veritabanında düz metin olarak saklanmaz.
- Admin panelindeki **Şifre** modülü yalnız `portal_admins` tablosunda yetkili Supabase kullanıcısıyla çalışır.
- Şifre değişince daha önce hatırlanan bütün cihaz anahtarları geçersiz olur.
- Aynı cihazdan art arda 5 yanlış deneme, asistan girişini 1 saat bloke eder.

## Veri Güvenliği Notu

Admin panelindeki **Yedekler** modülü, mevcut online verinin elle yedeğini alıp gerektiğinde geri yüklemek için eklendi.
Güvenli admin modu açılmadan önceki anon-key yapılandırması pratik prototip ve hızlı kullanım içindir.
