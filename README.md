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

## Toplu Veri Girişi

Admin panelindeki **Toplu Veri Girişi**, önceki beş metin girişinin ortak ekranıdır.
Uzman günlük çalışma, nöbetçi uzman ve rotasyoner kayıtlarının hafta/ay bazında yönetimi
de bu sekmenin altındadır; ayrı bir Uzman ve Rotasyoner sekmesi bulunmaz.
ChatGPT çıktısı `TÜR | YYYY-AA-GG | Kişi | Alan / durum` biçiminde hazırlanır;
`ROTASYONER` satırları yalnız ilk üç sütunu içerir. Tek metinde farklı türler ve tarihler bulunabilir.
Ekrandaki proje talimatları kopyalanabilir; güncel asistan ve alan referansı ayrıca kopyalanır.
Talimatların kaynak dosyası `src/bulk-import-instructions.txt` dosyasıdır.

Önizleme tüm satırları ve mevcut kayıtlara etkisini gösterir. Hatalı satır varsa hiçbir kayıt
uygulanmaz. Asistan nöbeti, uzman çalışma ve rotasyoner kayıtları birleştirilir;
izin/rotasyon kişinin günlük atamasının yerine geçer; uzman nöbeti yalnız belirtilen günlerin
tam listesini değiştirir. Açık planlama/alan taslakları toplu kaydı engeller.
Bulut yapılandırılmışsa kayıt doğrulanmadan uygulama verisi değiştirilmez; bağlantı sorunu
olursa yapıştırılan metin korunur. Bulut yapılandırılmamış yerel ortamda kayıt yalnız cihazda tutulur.

Aktarım kuralları için testler (Node.js 22.18+):

```bash
node --test tests/bulkImport.test.mjs
```

## Supabase

Online kayıt için `supabase/001_portal_state.sql` dosyasını Supabase SQL Editor'de çalıştır.
Otomatik/manüel yedek geçmişi için `supabase/002_portal_state_history.sql` dosyasının da çalışmış olması gerekir.

## Duyurular ve Rehberler

Uzman/asistan panelinin dördüncü sekmesinde yayınlanan içerikler kartlar halinde görünür.
Duyuru/rehber türü ve cihazda tutulan yıldızlılar ile filtrelenebilir. Arama, kategori
alanları ve başlık sayaçları gösterilmez; admin içerik formunda da kategori istenmez. Sabitlenen içerikler üstte, duyurular kendi içinde güncelden eskiye sıralanır.

Admin panelindeki aynı adlı sekmede metin, düzenlenebilir tablo, PNG/JPG/WebP ve PDF
bölümleri eklenir. Excel/Sheets'ten başlık satırı dahil tablo yapıştırılabilir. Bölüm sırası,
önizleme, taslak/yayınlama ve arşivden taslağa geri alma desteklenir. Dosya sınırı 8 MB'dır;
görseller özgün çözünürlükte saklanır ve büyütülebilir. Klinik içerik otomatik oluşturulmaz.

Güvenli admin kurulumundan sonra `supabase/009_portal_library.sql` uygulanır. İçerikler
`portal_library_items` tablosunda, dosyalar özel `portal-library` deposunda saklanır;
çalışma listesi ve onun yedeklerinden bağımsızdır. Mevcut yetkili Supabase admin oturumu
kullanılır. Yerel admin girişinde Supabase oturumu yoksa bu sekme yetkili hesapla giriş ister.
Taslaklar/arşivler yalnız admine açıktır; okuyucular yayınlanmış içeriklerin dosyaları için
bir saatlik imzalı bağlantı alır. Yayından kaldırınca yeni bağlantı üretilemez; daha önce
üretilen bağlantılar süreleri dolana kadar geçerli olabilir. Eski dosyalar geri alma ve
eşzamanlı düzenlemelerde veri kaybını önlemek için otomatik silinmez.

Supabase tanımlanmayan geliştirme ortamında içerikler ve dosyalar IndexedDB'de tutulur;
bu durum ekranda belirtilir. Aynı içeriğin başka oturumdan değiştirilmesi, eski sürümün
üzerine yazılmasını engeller. `tests/library.test.mjs` alan kurallarını;
`tests/library-db.sql` gerçek veritabanında RLS, dosya erişimi ve sürüm kontrolünü test eder.
SQL testi sentetik verileri tek işlemde kullanır, sonunda `ROLLBACK` yapar.

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
Mevcut kurulumlarda cihaz doğrulamasını şifre değişene kadar hatırlamak için ardından
`supabase/006_assistant_access_until_password_change.sql` dosyasını çalıştır.

- İlk ortak şifre `sancaktepe` olarak yalnız kurulum sırasında bcrypt hash biçiminde oluşturulur.
- Gerçek şifre tarayıcıda veya veritabanında düz metin olarak saklanmaz.
- Admin panelindeki **Şifre** modülü yalnız `portal_admins` tablosunda yetkili Supabase kullanıcısıyla çalışır.
- Doğru şifreden sonra tarayıcıda rastgele bir cihaz erişim kodu, Supabase'de ise yalnız bu kodun hash'i tutulur.
- Cihaz erişim kodu bir sonraki ortak şifre değişikliğine kadar geçerlidir.
- Şifre değişince daha önce hatırlanan bütün cihaz oturumları geçersiz olur.
- Tarayıcı/site verileri silinirse cihaz erişim kodu da silinir ve ortak şifre bir kez daha istenir.
- Aynı cihazdan art arda 5 yanlış deneme, asistan girişini 1 saat bloke eder.

## Veri Güvenliği Notu

Admin panelindeki **Yedekler** modülü, mevcut online verinin elle yedeğini alıp gerektiğinde geri yüklemek için eklendi.
Güvenli admin modu açılmadan önceki anon-key yapılandırması pratik prototip ve hızlı kullanım içindir.

## Çevrimiçi nöbet planlayıcı

Admin, başlıktaki **Nöbet listesi yap** düğmesinden veya `/?module=nobet` bağlantısından tam planlayıcıyı açar. `supabase/008_duty_planner.sql`, güvenli admin kurulumu ve önceki portal yedek tablosundan sonra uygulanır. Mevcut yerel JSON yedeği ilk kurulumda `duty_planner_state` içine bir kez aktarılır; boş veya örnek veriyle otomatik değiştirilmez.

Taslaklar ve otomatik yedekler yalnız yetkili admin tarafından okunabilir. Taslak kaydetmek asistanların gördüğü listeyi değiştirmez. **Yayınla**, kaydedilmiş seçili ayı önizleme ve onaydan sonra tek veritabanı işlemiyle portalın nöbet listesine aktarır. Diğer aylar, uzman listeleri, izinler ve kullanıcı eşleşmeleri korunur; yeni nöbetin ertesi günündeki normal çalışma ataması önizlemede gösterilerek kaldırılır. İsim eşleşmesi, ardışık nöbetler ve iki kaydın sürümü yeniden doğrulanır. Çakışma durumunda işlem durur.

Yerel programın eski kopyası bağımsız kalır; çevrimiçi çalışmaya geçtikten sonra güncel taslak için portal kullanılmalıdır. Tam JSON yedeği planlayıcının **Veri ve yedek** bölümünden indirilebilir.

Çevrimiçi sürüm, mevcut aktif kişi listesini koruyarak isimleri ve kıdemleri Asistan uygulamasından eşler. Aylık rotasyonların kaynağı yalnız `locationOwnersByMonth[ay]` ve `postDutyPoolByMonth[ay]` kayıtlarıdır; günlük çalışma listesi veya önceki ay varsayılmaz. Nöbet ertesi rotasyonu hastanesizdir. Rotasyon düzenlemeleri kaynak uygulamadan yapılır. Açılışta, kayıtta, yayın öncesinde ve açık/boşta ekranda 30 saniyede bir kontrol edilir. Eksik kaynak ayı boş gösterilir; çelişen hastaneler tahmin edilmeden uyarılır.

Geçmiş aylar ve kişi kimlikleri korunur. Kıdem değişiklikleri geçerli aydan başlayan `groupHistory` kayıtlarıyla hedef ve yetkinlik mirasına uygulanır. İsimler NFC/Türkçe harf/boşluk eşdeğerliğiyle eşleşir; farklı bir isme dönüşümde ortak kimlik bulunmadığından tahmin yapılmaz, eşleşme uyarısı gösterilir. Rotasyonerler ve arşivlenmiş kişiler otomatik aktifleştirilmez. Gerçek kaynak değişikliği, etkilediği tamamlanmış ayı yeniden taslağa çevirir. JSON nesnelerinin anahtar sırası değişiklik sayılmaz; kaynak güncellemesinden doğan sürümler yalnız kendi başarılı CAS kayıt zinciri üzerinden izlenir, gerçek başka bir kullanıcı kaydı varsa çakışma koruması devam eder.

Doğrulama: `npm run build`, `npm run lint`, `node --test tests/*.test.*`. `tests/duty-planner-db.sql`, kurulu veritabanında sentetik verilerle gerçek RLS/RPC kontrollerini bir işlem içinde çalıştırır ve sonunda her değişikliği `ROLLBACK` ile geri alır.
