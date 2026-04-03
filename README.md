# Atlas Paper Trader

Gercek piyasa verisiyle calisan, BIST evrenini tarayan, teknik analiz sinyalleri ureten ve demo para ile paper trading yapan bir Next.js uygulamasi.

## Ne Yapar

- Yahoo Finance `chart` uzerinden gunluk gercek fiyat verisini ceker.
- KAP uzerinden guncel BIST sirket evrenini ceker.
- Secili semboller icin 20/50 gunluk ortalama, RSI 14, momentum, volatilite ve ATR hesaplar.
- BIST 100 (`XU100.IS`) ile piyasa rejimini okur.
- Tum BIST hisselerini tarayip en yuksek skorlu adaylar icin risk ayarli alim onerisi uretir.
- Onerileri sepet mantigiyla secip tek tusla demo satin alma akisi sunar.
- Demo portfoy uzerinde alim, kisimli satis ve pozisyon kapatma simule eder.
- Portfoyu yerelde `data/paper-portfolio.json` dosyasina yazar.

## Onemli Not

Bu uygulama egitim ve simulasyon amaclidir. Kar garantisi vermez; gercek para ile kullanmadan once kendi arastirmani yapman gerekir.

## Calistirma

```bash
npm install
npm run dev
```

Sonra [http://localhost:3000](http://localhost:3000) adresini ac.

## Varsayimlar

- Demo hesap varsayilan olarak `TRY` bazlidir.
- Farkli para birimindeki semboller analiz edilir ama emir kabul edilmez.
- Varsayilan izleme listesi BIST odaklidir: `XU100.IS`, `THYAO.IS`, `ASELS.IS`, `BIMAS.IS`, `AKBNK.IS`, `EREGL.IS`, `SISE.IS`.
- BIST taramasi ilk seferde biraz surebilir; sonuclar onbellege alinip yeniden kullanilir.

## Mimari

- `app/api/dashboard`: veri ve teknik analiz cevabi
- `app/api/scanner`: tum BIST evreni taramasi ve oneriler
- `app/api/portfolio`: demo portfoy ozeti
- `app/api/orders`: paper trading emirleri
- `app/api/orders/bulk`: sepetten toplu demo alim
- `lib/market.ts`: piyasa verisi alma ve cache
- `lib/universe.ts`: KAP'tan BIST evreni alma
- `lib/scanner.ts`: tam piyasa taramasi ve oneriler
- `lib/portfolio.ts`: demo portfoy kaliciligi
- `components/market-lab.tsx`: ana panel
