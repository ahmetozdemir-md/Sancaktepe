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
Bu sekmenin altındaki **Kayıt Yönetimi** bölümünde asistan nöbeti, uzman günlük çalışma,
nöbetçi uzman ve rotasyoner kayıtları hafta/ay bazında silinir; asistan çıkarma ve alan kapatma
kontrolleri de buradadır. Günlük manuel atama temizliği mevcut Değiştir/Kaydet/İptal akışını
korur. Ayrı bir Uzman ve Rotasyoner sekmesi bulunmaz. Nöbet ve Planlama sekmeleri günlük
düzenleme için kullanılmaya devam eder.
ChatGPT çıktısı `TÜR | YYYY-AA-GG | Kişi | Alan / durum` biçiminde hazırlanır;
`ROTASYONER` satırları yalnız ilk üç sütunu içerir. Tek metinde farklı türler ve tarihler bulunabilir.
Ekrandaki proje talimatları kopyalanabilir; güncel asistan ve alan referansı ayrıca kopyalanır.
Talimatların kaynak dosyası `src/bulk-import-instructions.txt` dosyasıdır. Güncel talimatlar
beş tür için görsel/başlık okuma, kısaltma, örnek çıktı ve belirsizlik kurallarını içerir.
ChatGPT projesindeki eski talimat metni yeni metinle değiştirilmelidir.

Uzman çalışmada `Sancaktepe Ameliyathane 7 + Sancaktepe Ameliyathane 8` veya
`Sancaktepe Ameliyathane 7 + 8` gibi birleşik alanlar önizlemede ayrı kayıtlara açılır.
Kaynak satır numarası korunur, tekrarlar tekilleştirilir. Eşleştirme yalnız o tarihte aktif
alanlarda yapılır; belirsiz/eksik alan tüm aktarımı durdurur. Oda numarası veya hastane
alt metin benzerliğiyle başka alana eşleştirilmez.

Önizleme tüm satırları ve mevcut kayıtlara etkisini gösterir. Hatalı satır varsa hiçbir kayıt
uygulanmaz. Asistan nöbeti, uzman çalışma ve rotasyoner kayıtları birleştirilir;
izin/rotasyon kişinin günlük atamasının yerine geçer; uzman nöbeti yalnız belirtilen günlerin
tam listesini değiştirir. Açık planlama/alan taslakları toplu kaydı engeller.
Bulut yapılandırılmışsa kayıt doğrulanmadan uygulama verisi değiştirilmez; bağlantı sorunu
olursa yapıştırılan metin korunur. Bulut yapılandırılmamış yerel ortamda kayıt yalnız cihazda tutulur.

Aktarım kuralları için testler (Node.js 22.18+):

```bash
node --test tests/bulkImport.test.mjs tests/workLocationMatching.test.mjs
```

## Supabase

Online kayıt için `supabase/001_portal_state.sql` dosyasını Supabase SQL Editor'de çalıştır.
Otomatik/manüel yedek geçmişi için `supabase/002_portal_state_history.sql` dosyasının da çalışmış olması gerekir.

## Rehberler

Uzman/asistan panelinin dördüncü sekmesinde yayınlanan içerikler 20–30 başlığı
rahatça taramaya uygun kompakt bir liste halinde görünür. Alt konulu rehberler açılıp
kapanır; okuyucu örneğin Antibiyotikler → Vankomisin seçerek doğrudan ilgili içeriğe geçer.
Tüm rehberler veya cihazda tutulan yıldızlılar görüntülenebilir. Arama, kategori
alanları ve başlık sayaçları gösterilmez; admin içerik formunda da kategori istenmez. Sabitlenen rehberler üstte; başlıklar Türkçe alfabetik sırada gösterilir.
Tür seçimi yoktur; eski duyuru kayıtları veri kaybetmeden rehber olarak okunur ve sonraki
kayıtta `reference` türüyle saklanır.

Admin panelindeki aynı adlı sekmede metin, düzenlenebilir tablo, PNG/JPG/WebP ve PDF
bölümleri eklenir. İsteğe bağlı alt konular ayrı seçilerek düzenlenir ve içerikleriyle birlikte
yeniden sıralanabilir. Mevcut içerikler otomatik olarak genel içerik bölümünde açılır.
Excel/Sheets'ten başlık satırı dahil tablo yapıştırılabilir. Başlık ve veri satırlarına hazır
veya özel HEX renkleri uygulanır; yazı rengi kontrasta göre seçilir. Hizalama, sıkı/rahat
satır aralığı, satır taşıma ve çoğaltma desteklenir; renkler satırla birlikte taşınır. Bölüm sırası,
önizleme, taslak/yayınlama ve arşivden taslağa geri alma desteklenir. Dosya sınırı 8 MB'dır;
görseller özgün çözünürlükte saklanır ve büyütülebilir. Klinik içerik otomatik oluşturulmaz.

Metin bloklarında seçili yazıya kalın/normal, italik, altı/üstü çizili, yazı ve vurgu rengi,
bağlantı, başlık, liste, alıntı ve hizalama uygulanabilir. Biçim temizleme ve geri al/yinele
araçları bulunur. Tablo hücresine tıklayınca aynı yazı araçları etkinleşir; satırın zemin rengi
ve tablonun aralık/hizalama ayarları ayrı “Tablo görünümü” bölümündedir. Hücreye özel yazı
rengi seçilmezse zemin kontrastına göre otomatik renk kullanılır. Hücre biçimleri satırla
birlikte taşınır/çoğaltılır; sütun silme sırasında eşleşmeleri korunur.

Biçimler mevcut JSON içinde isteğe bağlı, izin verilen düğümlerle sınırlı belgeler olarak
saklanır; HTML çalıştırılmaz. Eski düz metinler değişmeden okunur. Biçimli belgenin metni
kaydedilmiş düz metinle uyuşmuyorsa düz metin gösterilir. Ağır yazı editörü yalnız admin
bir rehberi düzenlemeye başladığında yüklenir.

Güvenli admin kurulumundan sonra `supabase/009_portal_library.sql` uygulanır. İçerikler
`portal_library_items` tablosunda, dosyalar özel `portal-library` deposunda saklanır;
çalışma listesi ve onun yedeklerinden bağımsızdır. Alt konu başlıkları ve tablo biçimleri
mevcut `blocks` JSON alanında saklanır; ek veritabanı geçişi gerektirmez. Dosya yolları
erişim politikalarıyla uyumlu olarak üst seviyede kalır. Mevcut yetkili Supabase admin oturumu
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

## Asistan düzenleme

Asistan kartındaki **Düzenle** düğmesi ad-soyad ve kıdem alanlarını tek pencerede açar.
Değişiklikler birlikte kaydedilir; isim değişikliğinde ortak kişi kimliği ve geçmiş atamalar
korunur. Seçili kıdem numarası boş gruplar olsa bile yeniden numaralandırılmaz; diğer
asistanların kıdemleri değişmez. Aynı penceredeki **Asistanı sil** seçeneği, karttaki çarpı
ve Toplu Veri Girişi ile aynı isimli silme onayını açar. Vazgeçmek kayıtları değiştirmez.

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

Çevrimiçi sürüm, ortak `assistantRegistry` kimlikleriyle isimleri ve aylık nöbet katılımını Asistan uygulamasından alır. İlk eşleştirme mevcut 58 aktif kişiyi korur; yeni kişiler admin ay bazında **Nöbete dahil** seçeneğini açana kadar dışarıda kalır. İsim değişikliği ortak kimliği, geçmiş nöbetleri ve hedefleri korur. Kaynaktan ayrılan kişiler silinmez; eski nöbetleri korunur ve çözümlenmemiş atamalar yayın öncesinde uyarılır.

Aylık rotasyonların kaynağı yalnız `locationOwnersByMonth[ay]` ve `postDutyPoolByMonth[ay]` kayıtlarıdır; günlük çalışma listesi veya önceki ay varsayılmaz. Nöbet ertesi hastanesizdir. Bağlantının başlangıç ayından sonraki eski aylarda yapılan düzeltmeler de otomatik alınır. Açılışta, kayıtta, yayın öncesinde ve açık/boşta ekranda 30 saniyede bir kontrol edilir; küçük son eşleşme/hata göstergesi ve yeniden deneme düğmesi vardır.

Kıdem sırası `groups[].rankHistory` ile değişir; sabit grup kimliği, manuel hedefler ve ▲■●/Ç işaretleri başka gruba taşınmaz. Tutarsız kişi/grup sıraları tahmin edilmeden uyarılır. Gerçek rotasyon veya katılım değişikliği, etkilediği tamamlanmış ayı yeniden taslağa çevirir. JSON nesnelerinin anahtar sırası değişiklik sayılmaz; kaynak güncellemesinden doğan sürümler yalnız kendi başarılı CAS kayıt zinciri üzerinden izlenir, gerçek başka bir kullanıcı kaydı varsa çakışma koruması devam eder.

`010_secure_portal_reads.sql`, yayınlanan listelerin doğrudan anonim okunmasını kapatır. `read_portal_state` / `read_portal_revision` RPC'leri mevcut Supabase admin oturumu veya geçerli, iptal edilmemiş asistan cihaz anahtarı ister. Yeni istemci yüklenmeden önce RPC tanımları eklenir; tablo okuma yetkisi istemci yayınından sonra kapatılır. Açık listeler odak/30 saniye yenilemesiyle güncellenir; taslak düzenlemeler ve yeniden giriş sırasındaki kaydedilmemiş admin değişiklikleri korunur.

`011_shared_assistant_identity.sql`, eski istemci kayıtlarında ortak kimliğin kaybolmasını önler. `012_duty_publication_recovery.sql`, yayın nedeniyle kaldırılan çalışma atamalarını özel kayıtla izler. Sonraki yayında nöbet kaldırılmışsa, hâlâ güvenli olan eski yerler varsayılan olarak seçilmemiş öneriler halinde sunulur. Sonradan elle düzenlenen gün, izin, oda geçerliliği veya yeni nöbet çakışması varsa geri dönüş önerilmez. İzleme başlamadan önce kaldırılmış atamalar tahmin edilmez.

Doğrulama: `npm run build`, `npm run lint`, `node --test tests/*.test.*`. `tests/duty-planner-db.sql`, kurulu veritabanında sentetik verilerle gerçek RLS/RPC kontrollerini bir işlem içinde çalıştırır ve sonunda her değişikliği `ROLLBACK` ile geri alır.

### Asistanlardan rehber katkısı ve admin onayı

`013_library_contributions.sql`, rehber gönderilerini yayınlanmamış `pending` kayıtlar olarak tutar.
Mevcut rehberler `approved` olarak korunur. Asistanın geçerli cihaz oturumu ve ayrı rehber şifresi gerekir;
bu giriş hiçbir tabloya veya dosya deposuna doğrudan yazma yetkisi vermez. Admin **Rehberler → Onay bekleyenler**
üzerinden içeriği düzenler, onaylayarak yayınlar veya reddedip arşivler. Gönderici adı paylaşılan girişten geldiği için
tekil kişi kimliği doğrulaması değildir; inceleme ekranında “İletilen ad” olarak gösterilir.

Kurulum sırası: SQL geçişini uygula, `library-contributions` Edge Function'ı `verify_jwt=false` ile dağıt,
adminin **Şifreler → Rehber Gönderme Şifresi** bölümünden ilk şifreyi belirle, sonra istemciyi dağıt.
Fonksiyon kendi rastgele oturum anahtarını doğrular; Supabase service key yalnız sunucudadır.
İlk şifre kaynak koduna konmaz. Hash dışarıdan hazırlanacaksa pgcrypto ile uyumlu bcrypt `$2a$` biçimi gerekir;
tercih edilen yöntem `change_library_contributor_password` RPC'sinin hash'i sunucuda üretmesidir.
`LIBRARY_CONTRIBUTION_ORIGINS` varsayılan olarak üretim origin'ini içerir; ek origin gerekiyorsa açıkça yapılandırılır.

- Rehber oturumu 8 saattir; rehber şifresi veya asistan giriş şifresi değişince geçersiz olur.
- Cihaz anahtarı başına 3 gönderim/saat, 10/gün; ek IP, toplam istek, toplam dosya ve kuyruk sınırları vardır.
  Saat/gün pencereleri ilk kullanımdan itibaren ilerler; yarım kalan gönderim başlatmaları da kotaya dahildir.
- Şifre doğrulama cihaz başına 5 deneme/15 dakika; ek IP ve toplam deneme sınırları uygulanır.
- Metin/tablo içeriği izin verilen JSON alanlarına indirgenir. HTML, betik veya ham SVG kabul edilmez.
- Katılımcı PDF'leri tarayıcıda sayfa görsellerine dönüşür. Görseller sunucuda boyut ve PNG yapısı denetiminden
  geçip yalnız piksel verisinden tekrar üretilir; metadata ve ek dosya yükleri saklanmaz. Bu bir antivirüs taraması değildir.
- Gönderi başına 20 içerik bloğu, 8 görsel, dönüşümden sonra görsel başına 4 MB ve toplam 16 MB sınırı vardır.
  Henüz gönderilmemiş, süresi dolmuş dosyalar 24 saat sonra sonraki gönderim başlangıcında temizlenir.
- Klinik doğruluk adminin incelemesini gerektirir. Onaylanmayan içerik ve dosyalar okuyucuya kapalıdır.

`tests/libraryContributions.test.mjs` içerik/dosya doğrulamasını, `tests/library-contributions-db.sql`
gerçek RLS, kota, parola iptali ve onay akışını denetler. SQL testinin tüm değişiklikleri geri alınır.
