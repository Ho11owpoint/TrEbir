# Atlas Paper Trader - Proje Ozeti

Bu dosya, simdiye kadar gelistirilen uygulamanin ne yaptigini, nasil calistigini ve hangi noktalarda oldugunu ozetler.

## 1. Hedef

Amaç, gercek piyasa verisini kullanarak:

- hisseleri teknik olarak analiz eden,
- demo para ile alim-satim simule eden,
- kullaniciya sepet mantigiyla toplu demo alim yaptiran,
- modern bir arayuz uzerinden tum bu akisi gosteren

bir web uygulamasi olusturmakti.

Onemli not:
Bu uygulama kar garantisi vermez. "Maksimum kazanc" ifadesi dogrudan garanti edilemeyecegi icin, sistem risk-ayarlı ve skor bazli en iyi adaylari onerir.

## 2. Su Anda Neler Var

### 2.1 Gercek veri ile hisse analizi

Uygulama gercek piyasa verisini kullanir.

- Fiyat/mum verisi: Yahoo Finance `chart` endpoint
- BIST sirket evreni: KAP / BIST sirket listesi

Analiz edilen baslica teknik metrikler:

- 20 gunluk hareketli ortalama
- 50 gunluk hareketli ortalama
- RSI 14
- 1 aylik momentum
- 21 gunluk volatilite
- ATR 14
- 52 haftalik yuksek / dusuk referanslari

Bu verilerden her hisse icin:

- sinyal puani
- al / bekle / azalt yorumu
- nedenler listesi

uretiliyor.

### 2.2 Tum BIST evreni taramasi

Sistem artik yalnizca secili birkac hisseye bakmiyor.
KAP uzerinden BIST evrenini cekip tum hisseleri tarayabiliyor.

Tarama sonucu:

- en yuksek skorlu adaylar seciliyor,
- piyasa rejimi degerlendiriliyor,
- kullanicinin mevcut nakdi ve ozkaynak durumu dikkate aliniyor,
- her aday icin onerilen lot ve tutar hesaplanıyor.

### 2.3 Piyasa rejimi

BIST 100 (`XU100.IS`) uzerinden genel piyasa tonu okunuyor.

Sistem piyasa durumunu:

- `risk-on`
- `neutral`
- `risk-off`

olarak yorumluyor.

Bu bilgi, onerilen pozisyon boyutuna da etki ediyor.

### 2.4 Demo portfoy ve paper trading

Uygulama demo hesap ile calisiyor.

Desteklenen islemler:

- tekil alim
- tekil satis
- pozisyon kapatma
- sepetten toplu alim
- demo hesabi sifirlama

Portfoyde hesaplanan alanlar:

- nakit
- toplam ozkaynak
- acik pozisyonlar
- gerceklesen kar/zarar
- gerceklesmemis kar/zarar
- toplam getiri
- acik risk / exposure

Portfoy verisi yerelde su dosyada saklanir:

- `data/paper-portfolio.json`

## 3. Yeni Eklenen Ana Ozellikler

### 3.1 Oneri motoru

Tarama motoru her hisseyi bir `rankScore` ile siralar.
Bu skor olusturulurken su unsurlar dikkate alinir:

- sinyal puani
- momentum
- volatilite cezasi
- asiri RSI cezasi
- yuksek seviye yakinligi
- piyasa rejimi katkisi

Sonuc olarak en iyi adaylardan kisa liste olusturulur.

### 3.2 Sepet mantigi

Kullanici artik hisse secimini tek tek emir mantigiyla yapmak zorunda degil.

Yeni akista:

1. Sistem en iyi hisseleri oneriyor.
2. Kullanici istediklerini sepete ekliyor.
3. Istemediklerini sepetten cikariyor.
4. Lot sayisini degistirebiliyor.
5. Tek tusla tum sepeti demo olarak satin alabiliyor.

### 3.3 Modern arayuz

Arayuz daha modern ve daha "trading desk" hissi veren bir yapida yeniden duzenlendi.

Yeni tasarimda:

- buyuk hero alani
- piyasa rejimi karti
- tam evren tarama sonucu kartlari
- sticky sepet paneli
- odak hisse detay alani
- fiyat grafigi
- portfoy tablosu
- islem gunlugu

yer aliyor.

## 4. Teknik Mimari

### Frontend

- Next.js App Router
- React
- TypeScript
- CSS Modules

### Backend / Server tarafı

- Next.js route handlers
- server-side veri cekme
- local JSON tabanli demo portfoy kaliciligi

### Ana dosyalar

- `app/page.tsx`
  Ana sayfa giris noktasi

- `components/market-lab.tsx`
  Yeni ana dashboard

- `components/market-price-chart.tsx`
  Grafik bileseni

- `components/market-lab.module.css`
  Yeni modern arayuz stili

- `lib/universe.ts`
  KAP'tan BIST evrenini alma

- `lib/market.ts`
  Piyasa verisi ve anlik snapshotlar

- `lib/analysis.ts`
  Teknik indikator ve sinyal hesaplamalari

- `lib/risk.ts`
  Pozisyon boyutlama ve risk hesaplari

- `lib/scanner.ts`
  Tam BIST tarama, skorlama, oneriler

- `lib/portfolio.ts`
  Demo portfoy mantigi ve alim/satim islemleri

### API endpointleri

- `GET /api/dashboard`
  Secili hisseler icin klasik panel verisi

- `GET /api/scanner`
  Tum BIST evreni taramasi ve oneriler

- `GET /api/portfolio`
  Demo portfoy ozeti

- `POST /api/orders`
  Tekil emir

- `POST /api/orders/bulk`
  Sepetten toplu demo alim

- `POST /api/portfolio/reset`
  Demo hesabi sifirlama

## 5. Test ve Dogrulama

Su kontroller yapildi:

- `npm run lint`
- `npm run build`

Ikisi de basarili tamamlandi.

Ayrica uygulama akisi da canli olarak test edildi:

- `/api/scanner` ilk durumda `running` cevabi verdi
- tam tarama sonunda `ready` durumuna gecti
- ornek bir onerili hisse ile `/api/orders/bulk` kullanilarak toplu demo alim yapildi
- portfoyde yeni pozisyonun olustugu goruldu

Test sirasinda gozlenen ornek tarama durumu:

- evren: 712 hisse
- basarili analiz: 566
- basarisiz / veri eksik: 146
- onerilen hisse sayisi: 8

Bu sayilar zamanla degisebilir.

## 6. Bilinen Sinirlar

### 6.1 Kar garantisi yok

Bu sistem "parayi kesin katlar" seklinde sunulamaz.
Sistem, sadece veri destekli ve risk ayarli karar destegi sunar.

### 6.2 Veri kapsami sinirli olabilir

Bazi hisselerde Yahoo tarafinda eksik veya yetersiz veri gelebiliyor.
Bu nedenle tum BIST evreni her zaman tam analiz edilemeyebilir.

### 6.3 Demo hesap TRY bazli

Farkli para birimindeki hisseler analiz edilebilir ama demo alim akisi su anda TRY bazli tasarlandi.

### 6.4 Backtest yok

Su an sistem anlik analiz ve demo alim akisina odakli.
Gecmise donuk otomatik strateji backtest modulu henuz eklenmedi.

## 7. Kullanici Deneyimi Akisi

Kullanici uygulamayi actiginda:

1. Sistem BIST evrenini taramaya baslar.
2. Piyasa rejimi ve ust duzey metrikler gosterilir.
3. En yuksek skorlu hisseler kartlar halinde listelenir.
4. Kullanici kartlardan hisseleri sepete ekler.
5. Gerekirse lot sayisini degistirir.
6. Tek tusla demo satin alim yapar.
7. Portfoy ve islem gunlugu otomatik guncellenir.

## 8. Bir Sonraki Mantikli Adimlar

Eger proje daha da buyutulecekse en mantikli sonraki adimlar su olur:

- otomatik backtest modulu eklemek
- farkli strateji profilleri tanimlamak
  Ornek: momentum, breakout, mean reversion
- stop-loss / take-profit emir simulasyonu
- alarm ve bildirim sistemi
- coklu para birimi destegi
- daha profesyonel veri saglayicisina gecmek
- portfoy performans grafiklerini eklemek
- sektor bazli filtreleme ve tarama
- kullanici bazli hesap / oturum yapisi

## 9. Son Durum

Proje artik su seviyede:

- gercek veri kullanan
- tum BIST evrenini tarayabilen
- modern arayuze sahip
- sepet mantigiyla toplu demo alis yapabilen
- temel risk yonetimi barindiran

calisan bir prototip haline geldi.

Bu asamadan sonra proje, "analiz panosu" olmaktan cikıp daha profesyonel bir paper trading ve strateji arastirma platformuna donusturulebilir.
