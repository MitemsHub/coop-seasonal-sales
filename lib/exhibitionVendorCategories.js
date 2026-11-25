// lib/exhibitionVendorCategories.js
// What each exhibition vendor told us it sells, and the shopfront line we show
// for them.
//
// Why this file exists: a chip row built from the products' own category field
// was wrong more often than right, because vendors type that field late, leave
// it empty, or reuse one label for everything. The participation form, filled
// in before the market opens, is the vendor's actual statement of what they
// sell — so it is the first thing the shelf engine trusts.
//
// Categories are stored exactly as the vendor wrote them ("Fashion/Home Decor",
// "ALL TYPES OF PROTEIN, Food stuff and storage bowl"). lib/exhibitionShelf.js
// harmonises that free text into the canonical shelves, so this file stays a
// record of what was declared rather than a taxonomy to maintain.
//
// The `about` line is written copy, not a category: it is the stand's one-line
// pitch, shown on the stand card and page. A vendor or admin can replace it
// (exhibition_vendors.about); when the database has no line yet this copy is
// what the shop shows, so no stand is ever blank.
//
// Vendors that are not listed here (new stands added after the form) fall back
// to exhibition_vendors.category and then to their own name and products, so
// nothing is unreachable.

const norm = (s) =>
  String(s || '')
    .toUpperCase()
    .replace(/[’']/g, '')
    .replace(/[^A-Z0-9&]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

// [declared category, one-line stand description]
const VENDORS = {
  'STONE_DELIGHT LTD': ['Fashion', 'Ready-to-wear fashion and statement pieces, curated for everyday style.'],
  'FIVEPOINTS INFORMATION TECHNOLOGY LTD': ['Electronics', 'Phones, computers and everyday tech, with the accessories to match.'],
  'SHARP KITCHEN MATE GERMANY LTD': ['Kitchen utensils', 'German-quality kitchen utensils and cookware for everyday cooking.'],
  "GREATIE'S COLLECTIONS": ['Ladies shoes, handbags, laptop bags and boxes', "Ladies' shoes, handbags, laptop bags and gift boxes."],
  'DESIRED OLIVE LTD': ['Electronics', 'Consumer electronics and accessories, checked and ready to use.'],
  'ROZLEOS CHILDREN PLACE': ['Babies and Children items', "Baby and children's essentials, from clothing to everyday care."],
  'MARILISA LTD': ['Fashion Accessories And Timeless style Essentials', 'Timeless accessories and style essentials that finish an outfit.'],
  'TNK CONCEPT KIDDIES': ['Cloths', "Children's clothing in comfortable, hard-wearing everyday styles."],
  'ELSHEEDA INTL LTD': ['Fashion', 'Contemporary fashion for work, church and occasions.'],
  'EXCLUSIVE JEWELLERY': ['HIGH QUALITY FASHION JEWELRY & BEADS', 'High-quality fashion jewellery and hand-strung beads.'],
  'MABFARO HOUSEHOLD AND GIFT STORE': ['Household and kitchen items', 'Household and kitchen pieces, plus gifts for the home.'],
  'ULAMMAJEWELLRIES AND ACCESSORIES': ['Fashion', 'Fashion jewellery and accessories, styled for any look.'],
  'ATA UYAI': ['Fashion/Home Decor', 'Fashion and home decor pieces, picked for warmth and character.'],
  'BLISSFUL IMPORTS AND EXPORTS LTD': ['Fashion kiddies items toys, accessories and gadgets', "Kiddies' fashion, toys, accessories and small gadgets."],
  'HADASSAH CLOTHLINE CONCEPTS': ['Fashion and Kitchenware', 'Fashion pieces alongside practical kitchenware for the home.'],
  'ANNIKHA TRADITIONAL COLLECTION': ['Incense and more', 'Traditional incense and home fragrance, plus a few extras.'],
  'MAAMA MAY DIVINE CHILDRENS COLLECTION': ["Mother and Baby Care/ Kids and Children's Retail", "Mother-and-baby care and children's retail under one stand."],
  'DESTINY SUITS': ['Suits, shirts, trousers, etc.', 'Suits, shirts and trousers cut for a sharp, confident fit.'],
  'GRACEWILL KIDS PLACE': ['Kids clothes and accessories and gift and sourvinears', "Kids' clothes, accessories and gifts, including souvenirs."],
  'URHOMELIKEU INTERIORS': ['Interior Decor', 'Interior decor and finishing pieces that make a room feel done.'],
  "PRISCA'S MAKEOVERS ENTERPRISE": ['Skincare, Hair and beauty products.', 'Skincare, hair care and beauty products for a full routine.'],
  'LAUBEL KIDS': ['Fashion', 'Fashion for little ones, in soft, easy-to-wear styles.'],
  'ZITA PRIME LIMITED': ['KITCHEN UTENSILS AND HOME APPLIANCES', 'Kitchen utensils and home appliances for a busier kitchen.'],
  'ESPAT KIDDIES': ['Childrens fashion and accessories', "Children's fashion and accessories for every day and occasions."],
  'SPOONS AND NAPKINS': ['Small chops, Snacks and Grills', 'Small chops, snacks and grills, made fresh for the stand.'],
  'ENGLISH WORLD ELECTRICAL': ['Electricals.', 'Electrical fittings, cables and everyday electrical supplies.'],
  'DAMEL KIDDIES N ADULT': ['Fashion', 'Fashion for children and adults, in one family-friendly stand.'],
  'BTO ELECTRONICS AND FURNITURE': ['Electronics , power solutions , appliances', 'Electronics, power solutions and home appliances in one stop.'],
  'KHASAM EXCLUSIVE': ['FASHION', 'Corporate and occasion wear, including abayas and tailored gowns.'],
  'ZASSIDDIQ': ['FASHION', 'Fashion pieces with a modest, elegant cut.'],
  'HEALTHOVIA NIGERIA LIMITED': ['Health, Safety and wellness equipments', 'Health, safety and wellness equipment for home and workplace.'],
  'SAYANS FASHION': ['Fashion', 'Fashion staples and statement pieces in current styles.'],
  'ROSY UNDIES': ['Under wears, night wears, lounge wears.', 'Underwear, nightwear and loungewear in comfortable fabrics.'],
  'AEMAL SERVICES LIMITED': ['Fashion', 'Fashion for men and women, from casual to occasion.'],
  'GAWABS FASHION': ['Fashion', 'Ready-to-wear fashion with a clean, modern line.'],
  'OKADSSEAFOODAND': ['ALL TYPES OF PROTEIN , Food stuff and storage bowl', 'All types of protein, foodstuff and storage bowls.'],
  'HERMORAH NIGERIA LTD': ['Fashion', 'Fashion and accessories with a polished finish.'],
  "JAFIS CHILDREN'S COLLECTIONS": ['Kiddies/ clothing', "Kiddies' clothing in bright, comfortable everyday styles."],
  'TEA SIPS': ['Teas, skincare, jewelry, perfumes', 'Teas, skincare, jewellery and perfumes in one calm corner.'],
  'AMAT FABRICS NIG LIMITED': ['FASHION AND GENERAL MERCHANTS', 'Fabrics and fashion, plus general merchandise.'],
  "SPATO INTERNATIONAL VENTURES LIMITED/YINWA'HAIR": ['Fashion/ hair/ wigs accessories', 'Fashion, hair and wig accessories for a finished look.'],
  'SINOB NEEDLES & STYLES': ['FASHION ( CLOTHING)', 'Clothing and tailoring pieces for a made-to-fit wardrobe.'],
  'NICHOLE SIGNATURE BEAUTY WORLD': ['Fashion, Skin care, Makeups, Jewelries etc', 'Fashion, skincare, makeup and jewellery under one roof.'],
  'BEHIL360 DECOR': ['Interior decor', 'Interior decor pieces chosen to lift a space.'],
  'AESTHETICS DE SYKODIS LTD': ['Fashion/sugarcane juice', 'Fashion pieces and fresh sugarcane juice.'],
  'HARNESS ENERTECH LIMITED': ['Solar & Inverter Solutions', 'Solar and inverter solutions sized for homes and small businesses.'],
  'BLIZZ GLOBAL ENERGY LIMITED': ['SOLAR/inverter', 'Solar panels, inverters and the batteries that keep them running.'],
  'MAIZUBE FARMS NIGERIA LIMITED': ['Dairy and Vegetables', 'Farm-fresh vegetables and dairy, picked close to market day.'],
  'TRENDY MOTORS LTD': ['Cars', 'Cars and automobile options, with buying guidance on the stand.'],
  'SAGACITY&SERENDIPITY': ['Jewelry & Fashion Accessories', 'Jewellery and fashion accessories with a considered finish.'],
  '1268 INTERNATIONAL LIMITED': ['Health Gadgets, Electeonics and  Fashion', 'Health gadgets, electronics and fashion in one stand.'],
  'KENDERAS WOOD AND STEEL LIMITED': ['Kictenwares', 'Wood-and-steel kitchenware built for daily use.'],
  'JOKAT PATTIES': ['Kiddies items, souvenirs and Christmas decorating items', "Kiddies' items, souvenirs and Christmas decorations."],
  'FADFABRICS': ['fashion (Fabrics)', 'Fabrics by the yard, for tailoring and occasion wear.'],
  'CHILDREN PLACE ABUJA': ['Children essentials', "Children's essentials, from clothing to the small daily needs."],
  'GIGISHOUSEHOLD STORES': ['KITCHENWARES', 'Kitchenware and household pieces for a well-run home.'],
  'LUSH PRISTINE PERFS': ['Cosmetics', 'Cosmetics and fragrance, with testers at the stand.'],
  'FAITE MARQUE VENTURES': ['Fashion', 'Fashion pieces with a bold, contemporary feel.'],
  'URBAN AURA/HOUSE OF TUTU LTD': ['Fragrance (Diffuser and Perfume)', 'Diffusers and perfumes that keep a room and a person smelling good.'],
  'URBAN CRITERION LIMITED': ['Real Estate', 'Real estate options and property guidance.'],
  'ENDEE PLACE LTD': ['Materials for women,men,and Children', 'Fabric and clothing materials for women, men and children.'],
  'LEISURE COURT LIMITED': ['Real estate', 'Real estate and property enquiries.'],
  'FEMAC POWER SOLUTIONS LIMITED': ['Solar/Inverter', 'Solar and inverter power for steady, quiet electricity.'],
  'MANSHA HERBS': ['FOOD', 'Food and herbal goods, prepared in small batches.'],
  'NUGOX GLOBAL VENTURES': ['Fashion', 'Fashion for the season, in easy everyday cuts.'],
  'OSSYMANZE VENTURES': ['Fashion', 'Fashion and style pieces at market prices.'],
  'AVIX MOBILE': ['Phone Gadgets/solar inverter', 'Phone gadgets, accessories and solar inverters.'],
  'SIMS NIGERIA LIMITED': ['Electronics and Home Appliances', 'Electronics and home appliances, with after-sale support.'],
  'IMAAL.NG': ['Fashion', 'Fashion pieces styled for real life.'],
  'KENNAB FOODS': ['Foodstuffs and Provisions', 'Foodstuff and provisions for the family pantry.'],
  'BEAUTYPOINT COSMETICS': ['Fashion(cosmetics,skincare and makeup and hair', 'Cosmetics, skincare, makeup and hair products.'],
  'FORTE VISION GLOBAL SERVICES': ['Solar/Inverter', 'Solar energy systems and inverters, installed and supported.'],
  "TEE'S KIDDIES MALL": ['Children educational and montessori toys and learning materials', 'Educational toys and Montessori learning materials for children.'],
  'BIMICKS SOLUTION PLUS': ['Smart Security devices (CCTV), Solar Energy, Home automation devices', 'CCTV, solar energy and home automation devices.'],
  'NACHALLE LIMITED': ['Fashion... Leather products', 'Fashion and leather goods, finished by hand.'],
  'SOMI SOLAR': ['Solar Panel, inverters and Lithium batteries', 'Solar panels, inverters and lithium batteries.'],
  'BEAUTIFUL WOMAN CLOTHING AND ACCESSORIES': ['Fashion', 'Clothing and accessories for women, in flattering cuts.'],
  'TOLAJ KIDDIES WORLD': ['Fashion', "Kiddies' fashion and the accessories that go with it."],
  'NEN-RESTORE GLOBAL WELLNESS LTD': ['Fresh fruits,juices, smoothies  healthy Greek yogurt', 'Fresh fruit, juices, smoothies and Greek yogurt.'],
  'FLUXXYFRUITTIESCAFE': ['Food and Drinks', 'Food and drinks, served fresh from the stand.'],
  'STALLION MG AUTOMOBILES LIMITED': ['CARS', 'Cars and automobile enquiries.'],
  'ABUWA ENTERPRISES': ['Kitchen Appliances and  gowns', 'Kitchen appliances and gowns, side by side.'],
  'PROVISION HUB': ['Provisions', 'Provisions and pantry staples for the week.'],
  "MEENA'S FABRICHOUSE AND MORE": ['Fashion', 'Fabrics and fashion pieces for tailoring and ready wear.'],
  'YINKUS PLACE': ['Power Oil', 'Cooking oil and kitchen essentials.'],
  'DE OSEQ ROYAL SIGNATURE': ['Fashion', 'Fashion with a royal, occasion-ready signature.'],
  'CANDLESBIMOOD': ['Home fragrance, fragrance and fashion', 'Home fragrance, perfumes and fashion accents.'],
  'AMAMA KIDDIES N MORE': ['CHILDREN GOODS', "Children's goods, from clothing to everyday needs."],
  'VIDAHS BEAUTY AND FRAGRANCE WORLD': ['Fashion and toys', 'Fashion, toys and fragrance for the family.'],
  'JE-SIMEC ENERGY LIMITED': ['Electronics and Electrical gadgets', 'Electronics and electrical gadgets for home and work.'],
  'GIFTSETMORE VARIETY STORE': ['Household/ Utensils', 'Household items and utensils, plus gift options.'],
}

export { norm as normalizeVendorName }

// Words that describe a company rather than what it sells. They are dropped
// before comparing names, so "FORTE VISION ENERGY" still meets the form's
// "FORTE VISION GLOBAL SERVICES".
const LEGAL_WORDS = new Set([
  'LTD', 'LIMITED', 'NIG', 'NIGERIA', 'ENTERPRISE', 'ENTERPRISES', 'VENTURES', 'SERVICES',
  'GLOBAL', 'INTERNATIONAL', 'COMPANY', 'CO', 'AND', 'OF', 'THE', 'STORE', 'STORES', 'TRADING',
  'INVESTMENT', 'INVESTMENTS', 'PLACE', 'WORLD',
])

const coreTokens = (key) => key.split(' ').filter((w) => w && !LEGAL_WORDS.has(w))

// Keys are normalised once, here: the form writes "GREATIE'S COLLECTIONS" and
// "SPATO … LIMITED/YINWA'HAIR", while database names use neither apostrophe nor
// slash, so a raw-key lookup would miss exactly the vendors that need it most.
const PROFILES = Object.entries(VENDORS).map(([raw, value]) => ({
  key: norm(raw),
  value,
  core: coreTokens(norm(raw)),
}))

const BY_KEY = new Map(PROFILES.map((p) => [p.key, p.value]))

const startsWithTokens = (longer, shorter) =>
  shorter.length <= longer.length && shorter.every((token, i) => longer[i] === token)

/**
 * Find a vendor's profile in the form's table.
 *
 * The names in the database are not the names on the form: a suffix gets added
 * ("STONE_DELIGHT LTD (OLABISI_ADIRE)"), a suffix gets dropped ("SPATO
 * INTERNATIONAL VENTURES LIMITED"), or a trade word changes ("FORTE VISION
 * ENERGY" for "FORTE VISION GLOBAL SERVICES"). Match the exact normalised name
 * first, then a long word-aligned prefix, then the distinctive words with legal
 * suffixes removed — so a real stand does not fall back to "Other goods"
 * because of a bracket.
 */
export function vendorProfile(name) {
  const key = norm(name)
  if (!key) return { declared: '', about: '' }

  const exact = BY_KEY.get(key)
  if (exact) return { declared: exact[0], about: exact[1] }

  let best = null
  let bestLen = 0
  for (const p of PROFILES) {
    if (p.key.length < 8) continue
    if (key.startsWith(`${p.key} `) || p.key.startsWith(`${key} `)) {
      if (p.key.length > bestLen) {
        bestLen = p.key.length
        best = p
      }
    }
  }

  if (!best) {
    const core = coreTokens(key)
    if (core.length >= 2) {
      for (const p of PROFILES) {
        if (p.core.length < 2) continue
        const shorter = core.length <= p.core.length ? core : p.core
        const longer = shorter === core ? p.core : core
        if (shorter.join('').length < 8) continue
        if (startsWithTokens(longer, shorter) && shorter.join('').length > bestLen) {
          bestLen = shorter.join('').length
          best = p
        }
      }
    }
  }

  if (!best) return { declared: '', about: '' }
  return { declared: best.value[0], about: best.value[1] }
}

/** What this vendor declared it sells, exactly as written on the form. */
export function vendorDeclared(name) {
  return vendorProfile(name).declared
}

/** The written stand line — replaced by exhibition_vendors.about once edited. */
export function vendorAbout(name) {
  return vendorProfile(name).about
}

export function hasVendorProfile(name) {
  return !!vendorProfile(name).declared
}

export const VENDOR_PROFILE_COUNT = Object.keys(VENDORS).length

// Every written profile, for the seed migration (scripts build SQL from this).
export function vendorProfileEntries() {
  return PROFILES.map(({ key, value }) => ({ key, category: value[0], about: value[1] }))
}
