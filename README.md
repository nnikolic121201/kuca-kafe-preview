# Kuća kafe · Čačak

Lokalni predlog sajta sa zasebnim QR menijem i privatnom administracijom. Potreban je Node.js 18 ili noviji. Nema npm zavisnosti.

## Pokretanje

```sh
npm start
```

Otvorite http://127.0.0.1:4173. Meni je na `/meni`, a privatna prijava na `/upravljanje`.

Pri prvom pokretanju automatski nastaje administratorski nalog. Jedinstvena lozinka i korisničko ime nalaze se u `.local/admin-access.txt`. Lozinka se ne prikazuje u konzoli, kodu sajta niti HTTP odgovorima. Sačuvajte je u upravljaču lozinki, a zatim možete ukloniti taj tekstualni fajl. Autentifikacija koristi zaseban scrypt hash u `.local/account.json`. Administratorska sesija traje četiri sata, čuva se samo u memoriji otvorene stranice i prekida se osvežavanjem stranice, odjavom ili ponovnim pokretanjem servera.

## Meni i podaci

Početni katalog u `data/menu-catalog.json` sadrži 65 proizvoda u 11 kategorija, prepisanih iz dostavljenih fotografija menija. Za kafe je korišćen otvoreni cenovnik sa cenom espressa 130 RSD; druga fotografija kafe prikazuje drugačije cene. Proizvodi sa više veličina imaju odvojene S/M/L cene. Javni meni prikazuje proizvode i cene bez demonstracionih napomena. Cene, kategorije, veličine i dostupnost menjaju se kroz administraciju i trajno se čuvaju u `.local/menu.json`. Učitane slike čuvaju se u `.local/uploads` i podržavaju JPG, PNG i WebP do 3 MB.

Novi direktorijum podataka automatski dobija ovaj katalog. Postojeći sačuvan meni ne prepisuje se pri pokretanju. Za izričitu zamenu postojećeg menija katalogom prvo zaustavite server, zatim pokrenite:

```sh
node scripts/import-menu.mjs --server-stopped
npm start
```

Skripta najpre čuva neizmenjen prethodni `.local/menu.json` u `.local/backups`, a zatim atomski upisuje katalog. Ne menja nalog, lozinku niti učitane fotografije. Uvoz ponovite samo kada namerno želite da zamenite postojeće administratorske izmene početnim katalogom.

API prihvata `variants: [{ label: 'S', price: 180 }, ...]`, najviše šest jedinstvenih oznaka do 20 znakova. `price` uvek prati cenu prve veličine; `variants: []` vraća jednu cenu. Delimične izmene proizvoda zadržavaju postojeće veličine ako se polje `variants` ne pošalje.

Promene se zapisuju serijski i atomskim preimenovanjem datoteke. Podaci ostaju posle ponovnog pokretanja servera. Direktorijum `.local` ne ulazi u Git i nikada se ne servira kroz sajt; javno su dostupne samo pojedinačne slike iz njegovog `uploads` poddirektorijuma. Za rezervnu kopiju sačuvajte ceo `.local` na privatnom, pouzdanom mestu. Ne pokrećite više serverskih procesa nad istim direktorijumom podataka.

## Privatnost i autentičnost

Sajt ne postavlja kolačiće, nema analitiku i ne koristi localStorage/sessionStorage. Skripte, stilovi, fontovi i fotografije služe se lokalno. Administratorski token šalje se u Authorization zaglavlju i ne čuva se u browser storage-u. Nisu ugrađeni Instagram/Google widgeti. Spoljni linkovi otvaraju odgovarajuće servise tek kada ih posetilac izabere.

Google ocena i recenzije nisu prikazane jer nije povezan odobren Google API. Nema izmišljenih recenzija ni statičke ocene koja se predstavlja kao aktuelna. Fotografije i podaci o lokalu zahtevaju proveru i odobrenje vlasnika pre komercijalne objave. Hosting dobavljač može obrađivati tehničke podatke o zahtevima, što treba obuhvatiti konačnom politikom privatnosti.

## Provera

```sh
npm test
```

Testovi koriste zaseban privremeni direktorijum i proveravaju katalog, cene po veličinama i njihovo trajno čuvanje, autentifikaciju, zabranu neovlašćenih izmena, CRUD, pravila kategorija, validaciju, upload, isticanje sesije, ograničavanje prijava i zaštitu privatnih fajlova.

## Objavljivanje i QR kod

Lokalna adresa nije javni hosting. Za objavljivanje potreban je Node server sa trajnim diskom, HTTPS i domen. Postavite `HOST` i `PORT` prema hostingu; podrazumevana vrednost vezuje server samo za ovaj računar. Iza reverse proxy-ja postavite `APP_ORIGIN` na tačan javni HTTPS origin (bez završne kose crte), kako bi provera porekla administratorskih zahteva ostala uključena. Primeri promenljivih su u `.env.example`; server ne učitava `.env` automatski.

QR kod za štampu treba da vodi na konačan `https://vas-domen.rs/meni`, nikada na localhost ili privremenu razvojnu adresu. Promena proizvoda i cena ne menja tu putanju. Pre štampe proverite konačan domen na telefonu i potvrdite sadržaj cenovnika, radno vreme, kontakt, prava na fotografije i konačan logo sa vlasnikom.

## Render probni hosting

U repozitorijumu postoji `render.yaml` za besplatni probni Render Web Service. Pri kreiranju Blueprint-a unesite `ADMIN_USERNAME` i `ADMIN_PASSWORD` kao tajne u Render kontrolnoj tabli; nemojte ih stavljati u Git. Server koristi `RENDER_EXTERNAL_URL` za proveru porekla i Renderov javni port.

Besplatan Render nema trajni disk za Web Service: meni i uploadovane slike čuvaju se u `.local`, pa izmene mogu nestati pri uspavljivanju, restartu ili novom deploy-u. Koristite ovaj hosting za pregled i probu. Nemojte unositi ili obećavati trajne promene cenovnika dok se ne obezbedi trajna baza ili drugi odgovarajući hosting. Servis se uspavljuje posle 15 minuta bez poseta.
