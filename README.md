# GraDron — symulator lotu dronem FPV

Symulator drona FPV w przeglądarce: fizyka acro (dron nie stabilizuje się sam), tor wyścigowy
z 12 bramkami i dwie duże mapy misyjne, pomiar czasu, rekord zapisywany lokalnie, OSD jak z gogli.

## Uruchomienie

Kliknij dwukrotnie `index.html` — nic więcej nie trzeba (three.js leży lokalnie w `vendor/`,
brak połączenia z internetem nie przeszkadza). Potem kliknij w ekran startowy albo wciśnij spację.

Parametry: `index.html?auto` — pomija ekran startowy; `?map=port` / `?map=alpine` / `?map=tor` —
wybór mapy (można łączyć: `?auto&map=alpine`).

## Mapy

| Mapa | Plik | Czym jest |
|---|---|---|
| **Tor wyścigowy** | wbudowana w `game.js` | 12 bramek na czas, teren przemysłowy, rekord w `localStorage` |
| **Port Mewi** | `map-port.js` | port nad kanałem: suwnice STS, kontenery, statek, silosy, hala do wlotu, komin, most, linia WN, farma PV, budowa, las, plaża, farma offshore, latarnia |
| **Dolina Wilcza** | `map-alpine.js` | dolina górska (przewyższenie 300 m): zapora ze zbiornikiem, wyciąg krzesełkowy, schronisko z lądowiskiem, maszt, okap skalny, miejsce zdarzenia SAR |

Przełączanie: klawisz `K` albo pozycja **Mapa** w menu (`ESC`). Wybór zapamiętuje się w `localStorage`.

Mapy misyjne nie mają bramek — to lot swobodny pod przyszłe misje (katalog misji:
`../GraDron-mapy/MISJE.md`). Zamiast bramki OSD pokazuje **cel nawigacji**: `G` przełącza cel,
nad celem stoi słup światła, a `R` stawia drona 9 m nad nim. `T` wraca do bazy.
**Kontakt z wodą kończy lot** (kanał, morze, zbiornik, rzeka) — dron nie odbija się od tafli.

## Sterowanie

| Akcja | Klawiatura | Pad (Xbox 360 / One) |
|---|---|---|
| Gaz góra / dół | `W` / `S` (drążek bez sprężyny — trzyma wartość) | lewy drążek ↑/↓ |
| Yaw (obrót w miejscu) | `A` / `D` | lewy drążek ←/→ |
| Pitch (nos w dół / w górę) | `↑` / `↓` | prawy drążek ↑/↓ |
| Roll (przechył) | `←` / `→` | prawy drążek ←/→ |
| Respawn na ostatniej bramce | `R` | `A` |
| Kamera FPV / z 3. osoby | `C` | `B` |
| Tryb ACRO / ANGLE | `M` | `X` |
| Restart wyścigu | `T` | `Y` |
| Kąt kamery (FPV) lub dystans (3. osoba) −/+ | `[` / `]` | `LB` / `RB` |
| OSD on/off | `O` | `Back` |
| **MENU / powrót do lotu** | `ESC` (albo `P` / `H`) | `Start` |
| Dźwięk silników | `N` | (w menu) |
| Efekty analogowego VTX | `V` | (w menu) |
| Zmiana mapy | `K` | (w menu) |
| Cel nawigacji (mapy misyjne) | `G` | (w menu) |

## Menu (ESC / Start)

Pauzuje lot i pozwala na: tryb lotu, kamerę, kąt kamery FPV, dystans kamery z 3. osoby, sposób gazu
na padzie, dźwięk, efekty VTX, OSD, pełny ekran, respawn, restart wyścigu, skasowanie rekordu.
Nawigacja: `↑` `↓` + `ENTER` (`←` `→` zmieniają wartość), myszką, albo D-padem i `A` na padzie.
U dołu menu jest status pada i ściąga ze sterowania.

Prędkość wiatru można ustawić w menu na `OFF`, 1, 2, 4, 6, 8, 12 lub 16 m/s. Ustawienie jest
zapamiętywane lokalnie. OSD pokazuje chwilową prędkość wraz z podmuchami i kierunek ruchu powietrza.
Wiatr jest częścią aerodynamiki: wpływa na dryf, prędkość względem powietrza, opór i dźwięk szumu.

**Wyjście z ustawień prosto do lotu: `Start` na padzie** (albo `ESC`, `B`, lub pozycja „Wróć do lotu").
`Start` na ekranie startowym od razu odpala lot.

## Widok z 3. osoby

`C` (klawiatura) lub `B` (pad) przełącza FPV ↔ 3. osoba. Kamera z 3. osoby trzyma się pionu — nie
obraca się z rollem drona, więc horyzont zostaje poziomy — leci za dronem po jego kursie, patrzy
trochę przed niego i nie wchodzi w budynki ani pod ziemię (idzie promieniem od drona i zatrzymuje się
przed przeszkodą; jeśli ściana jest bliżej niż minimalny dystans, podnosi się nad drona).
Dystans 2–14 m: `[` / `]` albo `LB` / `RB`, też w menu. Po respawnie kamera ustawia się natychmiast,
bez doganiania drona przez pół mapy.

Uwaga: w trybie pełnoekranowym pierwsze `ESC` wychodzi z pełnego ekranu (tak działa przeglądarka) —
menu otworzy dopiero drugie `ESC` albo `Start` na padzie.

## Pad — jak jest mapowany gaz

Lewy drążek pada jest sprężynowany, a profil freestyle 5" potrzebuje ok. 22% gazu na zawis, więc są trzy tryby
(przełącznik „Gaz na padzie" w menu, zapamiętywany w `localStorage`):

- **HOVER** (domyślny) — środek drążka = zawis, w górę przyspieszasz, w dół schodzisz. Puszczony drążek
  utrzymuje wysokość, więc dron nie spada, gdy zdejmiesz kciuk.
- **LINIOWY** — klasyczne mapowanie osi: dół = 0%, środek = 50%, góra = 100%.
- **SPUSTKI** — gaz na `RT`, `LT` odejmuje (styl „gaz jak w grach wyścigowych").

Pad jest wykrywany automatycznie po pierwszym ruchu drążka lub wciśnięciu przycisku (widać to w OSD
w lewym dolnym rogu). Obsługiwane jest mapowanie standardowe (XInput — tak Chrome widzi pada 360)
oraz awaryjnie starsze mapowanie DirectInput ze spustkami na jednej osi.

## Jak się lata

- Gaz to ciąg **w kierunku, w którym patrzy dron** — żeby przyspieszyć, przechyl nos w przód i dodaj gazu.
- Zawis profilu freestyle 5" to ok. **22% gazu**. Przy starcie pomaga ground effect, a wraz z
  rozładowaniem pakietu pozycja zawisu lekko rośnie.
- Hamowanie: obrót o 180° i gaz, albo podbicie nosa do góry.
- W ACRO drążki zadają **prędkości kątowe** (roll/pitch 10,5 rad/s, yaw 7,0 rad/s) — poziom trzymasz sam.
  `M` przełącza na ANGLE (samopoziomowanie, wychylenie do 32°) na naukę.
- Zielona, pulsująca bramka + pionowy słup światła = następna bramka. Bramki trzeba zaliczać **po kolei**.
- Uderzenie z prędkością > ~6 m/s = crash i respawn na ostatniej zaliczonej bramce; lżejsze kontakty tylko odbijają.
- Czas startuje na pierwszej bramce, runda zamyka się na 12. bramce. Rekord ląduje w `localStorage`
  (klucz `gradron.best`).

## Pliki

- `index.html` — OSD, ekrany, style
- `game.js` — świat, fizyka, kolizje, wyścig, kamery, audio (WebAudio, bez plików dźwiękowych)
- `assets/textures/` — lokalne tekstury terenu i zabrudzonego betonu
- `vendor/three.min.js` — three.js r149 (build UMD, żeby działało z `file://` bez serwera)
- `vercel.json` — ustawienia hostingu statycznego i cache tekstur na Vercelu

## Mapa

Tor leży na opuszczonym terenie poprzemysłowym. Mapa zawiera niskie magazyny i biura techniczne,
zbiorniki, rurociągi, plac kontenerowy, komin, wieżę wodną, drogi z łatami, lampy, betonowe szykany,
kamienie, kępy trawy i zalesione obrzeże. Obiekty przy trasie mają kolizje, a dalsze wzgórza i budynki
służą jako niedrogie wydajnościowo tło. Materiały, oświetlenie ACES, miękkie cienie i mgła są ustawione
pod naturalny, lekko pochmurny dzień.

## Model lotu

Fizyka symuluje cztery osobne rotory, mikser QUAD X, regulator rate PID z feedforwardem, masę i tensor
bezwładności drona. Ciąg każdego śmigła zależy od kwadratu RPM, a silniki mają osobny czas rozpędzania
i hamowania. Model obejmuje również anizotropowy opór aerodynamiczny, napływ osiowy, sześciocelowy
pakiet LiPo z poborem prądu i voltage sag, Airmode/dynamic idle, propwash, ground effect oraz zmienny
z wysokością wiatr i podmuchy.

## Parametry do podkręcenia (`game.js`, sekcja „STAN LOTU / FIZYKA")

- Budowa: `MASS`, `MAX_THRUST`, `ARM`, `INERTIA`, `YAW_MOMENT`.
- Sterowanie: `RATE_RP`, `RATE_Y`, `_pidKp`, `_pidKi`, `_pidKd`, `_pidKff`.
- Napęd: `MOTOR_IDLE`, `MOTOR_TAU_UP`, `MOTOR_TAU_DOWN`.
- Bateria: `BAT_CELLS`, `BAT_CAPACITY_AH`, `BAT_INTERNAL_R`.

Trasę zmienia się w tablicy `WPS` (bramki są automatycznie ustawiane prostopadle do toru lotu).
