# Audit dizajna, tema i mikroanimacija

## Opseg

Audit obuhvaća frontend design tokene, light/dark i prilagođene teme, postavke
korisnika, admin editor tema, overlaye, virtualizirani popis poruka, administrativne
grafove i animacije statusa agenata.

## Sažetak nalaza

Postojeći vizualni sustav je već imao dobru osnovu: centralizirane tokene, serverski
validiran skup od 44 boje, named light/dark palete, no-flash boot, reduced-motion
politiku i kratke animacije. Raspored navigacije i gornji izbornici nisu zahtijevali
redizajn.

Najvažniji nedostaci bili su u rubnim slučajevima:

1. No-flash boot je znao prikazati paletu prethodnog OS moda.
2. Rjeđa nova paleta nije uvijek uklonila inline tokene prethodne palete.
3. Browser chrome nije pratio accent aktivne teme.
4. Admin editor nije prikazivao cijelu temu koju uređuje, nego pojedinačne tokene preko
   korisnikove aktivne palete.
5. Reset jednog tokena vizualno je uklanjao i druge nespremljene promjene.
6. Prilagođena tema nije imala provjeru kontrasta.
7. Dio dashboard tokena nije bio definiran.
8. Grafovi su animirali `height`, a agent progress `background-position`, što pokreće
   layout ili paint u svakom frameu.
9. Svaki virtualizirani red poruke trajno je tražio vlastiti compositor layer.
10. Menu tijekom exit animacije nije bio inertan i mogao je izgubiti povrat fokusa.
11. Search i Command Palette resetirali su rezultate i selekciju sinkronim efektima,
    stvarajući nepotreban dodatni render pri promjeni upita.

## Implementirano

- Jedan theme runtime primjenjuje light, dark, system i custom palete.
- Cache sprema obje system palete; boot bira onu koja odgovara trenutačnom OS modu.
- Stari inline tokeni se deterministički uklanjaju preko `data-theme-tokens`.
- `color-scheme`, `data-resolved-theme` i `<meta name="theme-color">` ostaju usklađeni.
- Disabled palete se preskaču pri izboru i fallbacku.
- Admin editor prikazuje punu paletu odgovarajućeg moda, bez zapisivanja previewa.
- Reset tokena ponovno primjenjuje cijeli nespremljeni preview.
- Semantički parovi boja moraju zadovoljiti WCAG AA 4.5:1 prije spremanja kroz UI.
- Chart animacije koriste `transform: scaleY()` s donjim originom.
- Agent progress koristi transformirani pseudo-element umjesto animiranog backgrounda.
- Reduced-motion uklanja dekorativno putovanje i prijelaze grafova.
- Virtualizirani redovi više nemaju trajni `will-change`.
- Dropdown pri izlazu postaje `inert` i vraća fokus na opener.
- Search reseti sada se događaju u korisničkom eventu, a valjani aktivni indeks se
  izvodi bez korektivnog rendera.

## Performansni standard

Animacije u ovom sloju koriste compositor-friendly `transform` i `opacity`; trajne
animacije prestaju kada status završi i gase se za reduced-motion. To uklanja poznate
izvore layouta i painta po frameu.

Fiksnih 60 FPS nije moguće garantirati na svakom uređaju jer rezultat ovisi o hardveru,
browseru, thermal throttlingu, broju vidljivih elemenata i drugim procesima. Prihvatni
kriterij je stabilan frame budget na podržanom referentnom hardveru, bez long animation
frames uzrokovanih Blob CSS-om. Produkcijsko profiliranje treba ponoviti za svaku novu
kontinuiranu animaciju i na low-end mobilnom referentnom uređaju.

## Daljnji prioriteti

1. Dodati automatski browser performance trace u CI na reprezentativnom velikom kanalu.
2. Proširiti kontrast validaciju na backend kada se definiraju kanonske bazne palete u
   dijeljenom formatu.
3. Profilirati collapse sidebara prije dodavanja animacije grid stupca; sadašnji prijelaz
   širine ne animira owner grid i zato je vizualno trenutan.
4. Dodati vizualnu regresiju svih shipped paleta u Chromiumu, WebKitu i Firefoxu.
