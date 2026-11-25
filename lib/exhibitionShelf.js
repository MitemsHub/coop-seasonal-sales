// lib/exhibitionShelf.js
// Sorts an exhibition branch's products onto the shelves a member shops by.
//
// Why this exists (and why it changed): the first version read the products'
// own category field. It was mostly empty, and the keyword guesses that filled
// the gaps were confidently wrong — every "Agiba corporate Turkey gown" landed
// under Meat, Fish & Eggs because the word "turkey" appears in its name.
//
// The shelf a product belongs to is now decided in this order:
//
//   1. What its vendor declared on the participation form (a fashion stand's
//      gowns are fashion, whatever the product is called). This is the vendor's
//      own statement of what they sell, and it cannot be fooled by a word like
//      "turkey". It lives in lib/exhibitionVendorCategories.js.
//   2. Which of that vendor's declared shelves the product itself fits, when
//      the vendor declared more than one ("Fashion and Kitchenware"). Keywords
//      in the product name, then its own category, then its description.
//   3. For a vendor with no declaration at all — a stand added after the form —
//      the shelves their business name names ("… BOUTIQUE", "MAMA'S KITCHEN",
//      "TOY WORLD"), then the categories their own products are filed under.
//      Product keywords are the last signal, and a product with no keyword
//      evidence at all inherits the shelf the rest of its stand landed on, so
//      a new vendor's shelf never fragments into "Other goods".
//
// Every product still lands on exactly one shelf, so the pills add up to the
// whole shop and nothing is unreachable.
import { vendorAbout, vendorDeclared } from './exhibitionVendorCategories'

// Order matters: shelf order breaks a keyword tie, so the more specific shelf
// sits above the broader one (produce before provisions, drinks before pantry).
//
// `aliases` read a vendor's declared category ("Fashion/Home Decor"). `words`
// read a product's own name and description. Both are matched as whole words,
// with a plural tolerant suffix, so "tin" cannot match "tinsel" and "water"
// cannot match "watermelon". Keywords are tried longest-first inside a shelf:
// "groundnut oil" is the oil it is, not "groundnut" plus a stray "oil".
export const SHELVES = [
  {
    key: 'fashion',
    label: 'Fashion & Fabric',
    icon: 'Shirt',
    aliases: [
      'fashion', 'cloth', 'cloths', 'clothing', 'wears', 'wear', 'apparel', 'fabrics', 'fabric',
      'suits', 'suit', 'gowns', 'gown', 'tailoring', 'ready to wear', 'women', 'men', 'ladies',
      'gents', 'fabrichouse',
    ],
    words: [
      'ankara', 'aso oke', 'lace', 'george', 'wrapper', 'fabric', 'cloth', 'gown', 'abaya',
      'kaftan', 'agbada', 'boubou', 'jalabiya', 'kimono', 'shirt', 'trouser', 'suit', 'blazer',
      'jean', 'dress', 'skirt', 'blouse', 'tshirt', 't-shirt', 'polo', 'two piece', 'turban',
      'gele', 'cardigan', 'jacket', 'waistcoat', 'jumpsuit', 'nightwear', 'night wear',
      'underwear', 'under wear', 'lingerie', 'brief', 'boxer', 'singlet', 'lounge wear',
      'corporate wear', 'swimwear', 'uniform', 'socks', 'stockings', 'kimono', 'corporate',
      'adire', 'hollandais', 'holland', 'kampala', 'aso ebi', 'asoke', 'aseoke',
      'ready to wear', 'veil', 'palazzo', 'shorts', 'crop top', 'senator', 'dashiki', 'kente',
    ],
  },
  {
    key: 'accessories',
    label: 'Jewellery & Accessories',
    icon: 'Gem',
    aliases: [
      'jewelry', 'jewellery', 'jewelleries', 'accessories', 'accessory', 'beads', 'handbags',
      'handbag', 'bags', 'shoes', 'footwear', 'souvenirs',
    ],
    words: [
      'jewellery', 'jewelry', 'jewelleries', 'beads', 'bead', 'earring', 'necklace', 'bangle',
      'bracelet', 'ring', 'anklet', 'watch', 'handbag', 'bag', 'purse', 'wallet', 'backpack',
      'laptop bag', 'shoe', 'sandal', 'slipper', 'sneaker', 'boot', 'loafer', 'heel', 'belt',
      'scarf', 'scarves', 'cap', 'hat', 'beret', 'sunglasses', 'keyholder', 'brooch', 'souvenir',
      'gift box',
    ],
  },
  {
    key: 'beauty',
    label: 'Beauty & Skincare',
    icon: 'Sparkles',
    aliases: [
      'beauty', 'cosmetics', 'makeup', 'makeups', 'skincare', 'skin care', 'perfumes', 'perfume',
      'fragrance', 'undies',
    ],
    words: [
      'skincare', 'skin care', 'cosmetics', 'makeup', 'make up', 'lipstick', 'foundation',
      'mascara', 'eyeliner', 'eyeshadow', 'nail polish', 'cream', 'lotion', 'body cream',
      'shea butter', 'vaseline', 'perfume', 'fragrance', 'diffuser', 'body spray', 'deodorant',
      'roll on', 'shampoo', 'conditioner', 'hair cream', 'hair oil', 'relaxer',
      'sanitary pad', 'soap', 'bath soap', 'toothpaste', 'toothbrush', 'razor',
      'shaving', 'serum', 'toner', 'cleanser', 'sunscreen', 'sunblock', 'makeup kit',
    ],
  },
  {
    key: 'hair',
    label: 'Hair & Wigs',
    icon: 'Scissors',
    aliases: ['wigs', 'wig', 'hair', 'hair extensions', 'bundles', 'frontal', 'closures'],
    // Real product names from the market: "20inches sdd pixxie curl paired with
    // a full frontal", "14inches sdd (RAW) bouncy closure fridge wig".
    words: [
      'wig', 'hair bundle', 'bundle', 'bundle deal', 'closure', 'frontal', 'hd lace',
      'lace frontal', '360 lace', 'sdd', 'raw hair', 'yaki', 'bone straight', 'bonestraight',
      'pixie curl', 'pixxie curl', 'burmese curl', 'deep wave', 'body wave', 'water wave',
      'piano wavy', 'bouncy', 'weave', 'braid', 'braiding hair', 'hair extension', 'hairpiece',
      'wig cap', 'hair net', 'bonnet', 'edge control',
    ],
  },
  {
    key: 'kids',
    label: 'Baby & Kids',
    icon: 'Baby',
    aliases: [
      'baby', 'babies', 'kids', 'kiddies', 'kid', 'children', 'childrens', 'mother and baby',
      'toys', 'toy', 'montessori', 'learning materials', 'children essentials', 'children goods',
    ],
    words: [
      'baby', 'infant', 'toddler', 'diaper', 'pampers', 'baby food', 'cerelac', 'nutribom', 'toy',
      'doll', 'teddy', 'kiddies', 'kiddy', 'kid', 'kids', 'children', 'school bag', 'baby wipes',
      'wipes', 'feeding bottle', 'pacifier', 'stroller', 'pram', 'montessori', 'learning material',
      'bib', 'cot',
    ],
  },
  {
    key: 'home',
    label: 'Home & Kitchen',
    icon: 'ShoppingBasket',
    aliases: [
      'kitchen', 'kitchenware', 'kitchenwares', 'kictenware', 'kictenwares', 'kicthenware',
      'kicthenwares', 'utensils', 'utensil', 'household', 'home appliances', 'appliances',
      'cookware', 'storage bowl', 'storage',
    ],
    words: [
      'pot', 'pan', 'saucepan', 'frying pan', 'cookware', 'utensil', 'plate', 'bowl', 'cutlery',
      'spoon', 'fork', 'knife', 'cup', 'mug', 'tumbler', 'flask', 'cooler', 'jug', 'kettle',
      'blender', 'mixer', 'grinder', 'stove', 'cooker', 'oven', 'microwave', 'refrigerator',
      'fridge', 'freezer', 'washing machine', 'air conditioner', 'pressing iron', 'gas cylinder',
      'cylinder', 'dish rack', 'hanger', 'mop', 'broom', 'bucket', 'dustbin', 'trash',
      'food container', 'water bottle', 'detergent', 'bleach', 'disinfectant', 'tissue',
      'toilet roll', 'towel', 'air freshener', 'insecticide', 'foil', 'cling film', 'nylon',
      'storage', 'household', 'kitchenware', 'warmer', 'food warmer', 'air fryer', 'airfryer',
      'food processor', 'chopper', 'casserole', 'bakeware', 'lunch box', 'cook set',
    ],
  },
  {
    key: 'interior',
    label: 'Interior & Decor',
    icon: 'Sofa',
    aliases: [
      'interior', 'decor', 'home decor', 'furniture', 'incense', 'christmas decor',
      'christmas decorating', 'candles', 'home fragrance',
    ],
    words: [
      'interior', 'decor', 'decoration', 'furniture', 'sofa', 'couch', 'table', 'chair', 'stool',
      'cabinet', 'wardrobe', 'curtain', 'rug', 'carpet', 'mat', 'bedding', 'duvet', 'bedsheet',
      'pillow', 'pillowcase', 'mattress', 'mirror', 'picture frame', 'wall art', 'artwork',
      'lamp', 'lampshade', 'vase', 'wall clock', 'incense', 'centerpiece', 'ornament',
      'christmas tree', 'christmas decoration', 'wreath', 'candle', 'scented candle',
      'candle holder',
    ],
  },
  {
    key: 'electronics',
    label: 'Phones & Electronics',
    icon: 'Smartphone',
    aliases: [
      'electronics', 'electronic', 'electrical', 'electricals', 'phones', 'phone', 'gadgets',
      'gadget', 'cctv', 'security', 'automation', 'computers', 'computer', 'tech', 'devices',
    ],
    words: [
      'phone', 'smartphone', 'iphone', 'samsung', 'tecno', 'infinix', 'itel', 'android', 'charger',
      'cable', 'earpiece', 'headphone', 'earphone', 'airpod', 'power bank', 'powerbank', 'laptop',
      'tablet', 'computer', 'monitor', 'keyboard', 'mouse', 'printer', 'router', 'modem', 'camera',
      'cctv', 'security camera', 'memory card', 'usb', 'bluetooth', 'speaker', 'soundbar', 'tv',
      'television', 'remote', 'gaming', 'console', 'gadget', 'smart watch', 'smartwatch',
      'home automation', 'security device', 'fan', 'standing fan', 'ceiling fan', 'air cooler',
      'rechargeable fan', 'extension box', 'stabiliser', 'stabilizer',
    ],
  },
  {
    key: 'solar',
    label: 'Solar & Power',
    icon: 'Zap',
    aliases: [
      'solar', 'inverter', 'inverters', 'power solutions', 'lithium', 'panels', 'panel', 'energy',
      'batteries', 'battery', 'ups',
    ],
    words: [
      'solar', 'solar panel', 'inverter', 'battery', 'lithium', 'lithium battery', 'generator',
      'charge controller', 'solar street light', 'energy', 'power station',
    ],
  },
  {
    key: 'produce',
    label: 'Fresh Produce',
    icon: 'Carrot',
    aliases: ['vegetables', 'vegetable', 'fruits', 'fruit', 'farm', 'fresh', 'produce'],
    words: [
      'tomato', 'pepper', 'tatashe', 'rodo', 'shombo', 'onion', 'yam', 'potato', 'plantain',
      'banana', 'orange', 'apple', 'mango', 'pineapple', 'watermelon', 'cucumber', 'carrot',
      'cabbage', 'lettuce', 'vegetable', 'ugu', 'ewedu', 'okra', 'okro', 'spinach', 'garden egg',
      'eggplant', 'avocado', 'pawpaw', 'waterleaf', 'bitter leaf', 'scent leaf', 'efirin', 'lemon',
      'lime', 'grape', 'pear', 'strawberry', 'cocoyam', 'taro', 'shallot', 'spring onion',
      'broccoli', 'cauliflower', 'green bean', 'peas', 'groundnut', 'coriander', 'kale', 'parsley',
      'mint', 'basil', 'ginger', 'garlic', 'habanero',
    ],
  },
  {
    key: 'protein',
    label: 'Meat, Fish & Eggs',
    icon: 'Beef',
    aliases: ['protein', 'meat', 'meats', 'fish', 'seafood', 'sea food', 'chicken', 'turkey'],
    words: [
      'chicken', 'beef', 'cow meat', 'goat meat', 'mutton', 'ram', 'pork', 'fish', 'croaker',
      'titus', 'mackerel', 'catfish', 'tilapia', 'stockfish', 'panla', 'egg', 'gizzard', 'shaki',
      'pomo', 'ponmo', 'kpomo', 'offal', 'snail', 'prawn', 'shrimp', 'crab', 'periwinkle',
      'sausage', 'bacon', 'ham', 'duck', 'quail', 'turkey wings', 'turkey breast', 'whole turkey',
      'frozen turkey', 'turkey meat',
    ],
  },
  {
    key: 'food',
    label: 'Food & Provisions',
    icon: 'Wheat',
    aliases: [
      'food', 'foods', 'foodstuff', 'foodstuffs', 'provisions', 'provision', 'groceries', 'pantry',
      'staples', 'dairy', 'oil', 'seasonings', 'seasoning', 'spices', 'spice', 'flour', 'rice',
      'herbs',
    ],
    words: [
      'rice', 'beans', 'garri', 'semo', 'semovita', 'semolina', 'wheat', 'maize', 'corn', 'millet',
      'sorghum', 'flour', 'starch', 'cassava', 'elubo', 'fufu', 'yam flour', 'spaghetti',
      'macaroni', 'noodles', 'pasta', 'oats', 'cereal', 'cornflakes', 'pap', 'akamu', 'couscous',
      'soya', 'soybean', 'oil', 'palm oil', 'groundnut oil', 'vegetable oil', 'seasoning', 'maggi',
      'knorr', 'salt', 'sugar', 'crayfish', 'ogiri', 'iru', 'dawadawa', 'locust bean', 'spice',
      'curry', 'thyme', 'pepper', 'tomato paste', 'tin tomato', 'sardine', 'corned beef',
      'baked beans', 'custard', 'jam', 'peanut butter', 'butter', 'margarine', 'honey', 'milk',
      'powdered milk', 'evaporated milk', 'cocoa', 'milo', 'bournvita', 'ovaltine', 'provisions',
      'foodstuff',
    ],
  },
  {
    key: 'drinks',
    label: 'Drinks & Beverages',
    icon: 'Coffee',
    aliases: [
      'drinks', 'drink', 'beverages', 'beverage', 'teas', 'tea', 'juices', 'juice', 'smoothies',
      'smoothie', 'yogurt', 'yoghurt', 'coffee', 'wine', 'water', 'sugarcane juice', 'milkshake',
    ],
    words: [
      'water', 'bottled water', 'table water', 'coke', 'cola', 'fanta', 'sprite', 'pepsi',
      'mirinda', '7up', 'schweppes', 'malt', 'maltina', 'juice', 'drink', 'tea', 'coffee',
      'nescafe', 'wine', 'beer', 'champagne', 'whisky', 'whiskey', 'gin', 'vodka', 'brandy',
      'soft drink', 'zobo', 'kunu', 'chapman', 'energy drink', 'red bull', 'yogurt', 'yoghurt',
      'smoothie', 'sugarcane juice', 'milkshake', 'milk drink',
    ],
  },
  {
    key: 'snacks',
    label: 'Snacks & Pastries',
    icon: 'Cookie',
    aliases: [
      'snacks', 'snack', 'small chops', 'grills', 'grill', 'pastries', 'pastry', 'bakery', 'cakes',
      'cake',
    ],
    words: [
      'biscuit', 'cookie', 'chin chin', 'puff puff', 'puffpuff', 'gala', 'sausage roll', 'meat pie',
      'cake', 'bread', 'loaf', 'chocolate', 'candy', 'sweet', 'toffee', 'lollipop', 'kuli kuli',
      'plantain chips', 'popcorn', 'wafer', 'cracker', 'doughnut', 'donut', 'snack', 'small chops',
      'grill', 'suya', 'shawarma', 'pie', 'pastry',
    ],
  },
  {
    key: 'health',
    label: 'Health & Wellness',
    icon: 'HeartPulse',
    aliases: [
      'health', 'wellness', 'safety', 'medical', 'pharmacy', 'herbal', 'supplements', 'supplement',
      'fitness',
    ],
    words: [
      'paracetamol', 'malaria', 'antibiotic', 'vitamin', 'supplement', 'capsule', 'syrup',
      'bandage', 'plaster', 'thermometer', 'face mask', 'hand sanitizer', 'sanitizer', 'herbal',
      'pain relief', 'first aid', 'glucose', 'blood pressure', 'oximeter', 'massage', 'dumbbell',
      'yoga mat',
    ],
  },
  {
    key: 'auto',
    label: 'Cars & Automobile',
    icon: 'Car',
    aliases: [
      'cars', 'car', 'automobile', 'automobiles', 'motors', 'motor', 'vehicles', 'vehicle',
      'spare parts', 'tyres', 'tyre',
    ],
    words: [
      'car', 'vehicle', 'tyre', 'tire', 'spare part', 'engine oil', 'car battery', 'windscreen',
      'bumper', 'headlight', 'automobile',
    ],
  },
  {
    key: 'property',
    label: 'Property & Real Estate',
    icon: 'Building2',
    aliases: ['real estate', 'property', 'properties', 'estate'],
    words: ['real estate', 'property', 'plot', 'apartment', 'duplex', 'bungalow'],
  },
  {
    key: 'office',
    label: 'School & Office',
    icon: 'BookOpen',
    aliases: ['school', 'office', 'stationery', 'books', 'book'],
    words: [
      'book', 'notebook', 'exercise book', 'pen', 'pencil', 'biro', 'ruler', 'eraser', 'stapler',
      'a4', 'paper', 'envelope', 'file', 'folder', 'calculator', 'marker', 'crayon', 'textbook',
      'jotter', 'sharpener', 'glue', 'sticky note',
    ],
  },
]

const OTHER = { key: 'other', label: 'Other goods', icon: 'Package' }

const BY_KEY = new Map(SHELVES.map((s) => [s.key, s]))

// Icons are strings here so this file stays free of JSX; the filter bar is the
// one place they are resolved to components.
export const SHELF_ICONS = [
  'Wheat', 'Carrot', 'Beef', 'Droplets', 'Coffee', 'Cookie', 'ShoppingBasket', 'SprayCan',
  'Flower2', 'Shirt', 'Smartphone', 'Baby', 'HeartPulse', 'Sprout', 'BookOpen', 'Hammer',
  'Package', 'Tags', 'Gem', 'Sparkles', 'Sofa', 'Zap', 'Car', 'Building2', 'Scissors',
]

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Business-name vocabulary. A form says "Fashion"; a shopfront sign says
// "Boutique", "Fabrics", "Autos", "Supa Mart". These words are only used to
// read a vendor's *name*, so a brand-new stand that has not filled the form in
// still lands on the right shelf instead of "Other goods".
const NAME_ALIASES = {
  fashion: [
    'boutique', 'fashion house', 'clothing line', 'textile', 'textiles', 'couture', 'tailor',
    'tailors', 'menswear', 'womenswear', 'outfitters', 'stitches', 'fashionista',
  ],
  accessories: [
    'jewel', 'jewels', 'gemstone', 'beadwork', 'eyewear', 'millinery', 'accessorize',
    'wristwatch',
  ],
  beauty: [
    'beauty supply', 'beauty hub', 'beauty palace', 'cosmetic', 'salon', 'makeover', 'nails',
    'barber', 'barbing', 'haircare', 'shea',
  ],
  kids: [
    'baby shop', 'baby care', 'baby store', 'toddler', 'nursery', 'toy shop', 'toyworld',
    'kidswear', 'pram',
  ],
  home: [
    'home essential', 'houseware', 'homeware', 'kitchen shop', 'utensil shop', 'cookshop',
    'catering equipment', 'home store',
  ],
  interior: ['interiors', 'furnishings', 'upholstery', 'drapes', 'curtains', 'lighting', 'mattress'],
  electronics: [
    'phone shop', 'phone hub', 'gadget hub', 'electronics hub', 'tech hub', 'computer shop',
    'mobiles', 'ict', 'security systems', 'home automation',
  ],
  solar: ['solar hub', 'energy solutions', 'inverter shop', 'renewable', 'solar energy'],
  produce: ['fruits and vegetables', 'veggies', 'greengrocer', 'farm fresh', 'agro produce'],
  protein: [
    'butchery', 'butcher', 'meat shop', 'fish market', 'seafoods', 'sea foods', 'poultry',
    'frozen foods', 'frozen food',
  ],
  food: [
    'supermarket', 'supa mart', 'super market', 'minimart', 'mini mart', 'grocery', 'groceries',
    'provision store', 'food mart', 'foods', 'grocer', 'pantry',
  ],
  drinks: [
    'wine shop', 'wines', 'spirits', 'liquor', 'cafe', 'coffee shop', 'juice bar',
    'smoothie bar', 'teahouse', 'beverages',
  ],
  snacks: ['bakery', 'patisserie', 'confectionery', 'cake shop', 'snack shop', 'grill house'],
  health: ['pharmacy', 'chemist', 'drugstore', 'clinic', 'fitness', 'gym', 'nutrition'],
  auto: ['autos', 'automobile', 'car mart', 'car shop', 'auto parts', 'tyres', 'spare parts'],
  property: ['realty', 'realtors', 'estates'],
  office: ['stationery', 'bookshop', 'books', 'office supplies', 'school supplies'],
}

// One alternation per keyword list, compiled once: testing ~200 keywords product
// by product across a 1,000-product branch would be the slowest thing on the
// page. Longest keyword first, because an alternation takes the first branch
// that fits ("groundnut oil" before "groundnut").
const rxCache = new Map()
function matcher(words) {
  let rx = rxCache.get(words)
  if (!rx) {
    const ordered = [...words].sort((a, b) => b.length - a.length)
    rx = new RegExp(`\\b(?:${ordered.map(escape).join('|')})(?:s|es)?\\b`, 'gi')
    rxCache.set(words, rx)
  }
  return rx
}

// Lowercase, apostrophes dropped ("Children's" → "childrens") and punctuation
// flattened, so one matcher reads declared categories, names and descriptions.
const text = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9&]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

function scan(hay, rx) {
  if (!hay) return { count: 0, longest: 0 }
  rx.lastIndex = 0
  let count = 0
  let longest = 0
  let m = rx.exec(hay)
  while (m) {
    count += 1
    if (m[0].length > longest) longest = m[0].length
    if (m.index === rx.lastIndex) rx.lastIndex += 1
    m = rx.exec(hay)
  }
  return { count, longest }
}

/**
 * Read a vendor's free-text category and return the shelves it names.
 * "Fashion/Home Decor" → ['fashion', 'interior'].
 */
export function harmonizeCategory(value) {
  const hay = text(value)
  if (!hay) return []
  const keys = []
  for (const shelf of SHELVES) {
    if (scan(hay, matcher(shelf.aliases)).count > 0) keys.push(shelf.key)
  }
  return keys
}

/**
 * Read a business name the way a customer reads the sign: "ZARA BOUTIQUE",
 * "MAMA'S KITCHEN", "PRIME SOLAR HUB". This is the safety net for a stand the
 * participation form does not know about.
 */
export function harmonizeVendorName(name) {
  const hay = text(name)
  if (!hay) return []
  const keys = []
  for (const shelf of SHELVES) {
    const extra = NAME_ALIASES[shelf.key]
    const named =
      scan(hay, matcher(shelf.aliases)).count > 0 ||
      (extra ? scan(hay, matcher(extra)).count > 0 : false)
    if (named) keys.push(shelf.key)
  }
  return keys
}

/**
 * The shelves this vendor sells from. An edited/declared category wins (so an
 * admin can correct a stand), then the participation form's copy, then the
 * business name, then the categories the vendor's own products are filed under
 * (see categorizeShelf).
 */
export function vendorShelfKeys(vendor) {
  if (!vendor) return []
  const declared = vendor.category || vendorDeclared(vendor.name) || ''
  const keys = harmonizeCategory(declared)
  if (keys.length) return keys
  return harmonizeVendorName(vendor.name)
}

export function vendorShelfLabels(vendor) {
  return vendorShelfKeys(vendor)
    .map((key) => BY_KEY.get(key)?.label)
    .filter(Boolean)
}

/** The stand's one-line pitch: the vendor's edited copy, else the written one. */
export function vendorAboutLine(vendor) {
  if (!vendor) return ''
  return String(vendor.about || '').trim() || vendorAbout(vendor.name)
}

function shelfScore(product, shelf) {
  const name = scan(text(product.name), matcher(shelf.words))
  const category = scan(text(product.category_name), matcher(shelf.words))
  const detail = scan(text(product.description), matcher(shelf.words))
  // The vendor's own product name is the strongest product-level evidence;
  // their product category is next; a description mention alone is a hint.
  return (
    name.count * 6 + name.longest * 2 +
    category.count * 3 + category.longest +
    detail.count
  )
}

/**
 * Sort a product list onto shelves.
 * @param {Array} products
 * @param {Array} vendors  the cycle's vendors, for their declared categories
 * @returns {{ keyOf: Map<number,string>, shelves: Array<{key,label,icon,count}>, total: number }}
 */
// A stand whose name and form say nothing ("NEW VENTURES", "1268") still files
// its products under something. When several of them share a category, that is
// the stand's shelf.
function inferFromProductCategories(list) {
  if (!list.length) return []
  const tally = new Map()
  for (const p of list) {
    for (const key of harmonizeCategory(p.category_name)) {
      tally.set(key, (tally.get(key) || 0) + 1)
    }
  }
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]
  return top ? [top[0]] : []
}

export function categorizeShelf(products = [], vendors = []) {
  const vendorById = new Map()
  for (const v of vendors) vendorById.set(Number(v.id), v)

  // Each vendor's products, so an undeclared stand can be read from the
  // categories its own products carry.
  const byVendor = new Map()
  for (const p of products) {
    const id = Number(p.vendor_id)
    if (!byVendor.has(id)) byVendor.set(id, [])
    byVendor.get(id).push(p)
  }

  // Resolved once per vendor instead of once per product.
  const allowedByVendor = new Map()
  const allowedFor = (vendorId) => {
    if (!allowedByVendor.has(vendorId)) {
      let keys = vendorShelfKeys(vendorById.get(vendorId))
      if (!keys.length) keys = inferFromProductCategories(byVendor.get(vendorId) || [])
      allowedByVendor.set(vendorId, keys.map((k) => BY_KEY.get(k)).filter(Boolean))
    }
    return allowedByVendor.get(vendorId)
  }

  const assignment = new Map()
  // Products of a multi-category stand that carry no evidence of their own:
  // they follow the stand's other products, and only fall back to the first
  // declared shelf when the whole stand is silent.
  const weak = []
  const weakIds = new Set()
  // Products with no shelf to be placed on yet.
  const unresolved = []

  for (const p of products) {
    const allowed = allowedFor(Number(p.vendor_id))
    let entry = null

    if (allowed.length === 1) {
      // The vendor sells one thing: their word settles it.
      entry = allowed[0]
    } else if (allowed.length > 1) {
      // Multi-category stand: the product decides within the vendor's own
      // shelves, so "storage bowl" leaves a seafood stand's shelf for Home.
      let best = -1
      for (const shelf of allowed) {
        const score = shelfScore(p, shelf)
        if (score > best) {
          best = score
          entry = shelf
        }
      }
      if (best <= 0) {
        weak.push({ id: p.id, vendorId: Number(p.vendor_id), allowed })
        weakIds.add(p.id)
        entry = null
      }
    } else {
      // No declaration anywhere: product keywords across every shelf, then the
      // product's own category as typed by the vendor.
      let bestScore = 0
      for (const shelf of SHELVES) {
        const score = shelfScore(p, shelf)
        if (score > bestScore) {
          bestScore = score
          entry = shelf
        }
      }
      if (!entry) {
        const keys = harmonizeCategory(p.category_name)
        entry = keys.map((k) => BY_KEY.get(k)).find(Boolean) || null
      }
    }

    if (entry) assignment.set(p.id, entry)
    // Weak products are placed by their stand in the next pass; they must not
    // also land in `unresolved`, or the second pass would overwrite the stand
    // shelf with "Other goods".
    else if (!weakIds.has(p.id)) unresolved.push(p)
  }

  // What each stand has actually landed on so far — the reference the silent
  // products are placed against.
  const tallyByVendor = new Map()
  for (const p of products) {
    const entry = assignment.get(p.id)
    if (!entry) continue
    const id = Number(p.vendor_id)
    if (!tallyByVendor.has(id)) tallyByVendor.set(id, new Map())
    const tally = tallyByVendor.get(id)
    tally.set(entry.key, (tally.get(entry.key) || 0) + 1)
  }

  const bestOf = (tally, shelves) => {
    let entry = null
    let best = 0
    if (!tally) return null
    for (const shelf of shelves) {
      const n = tally.get(shelf.key) || 0
      if (n > best) {
        best = n
        entry = shelf
      }
    }
    return entry
  }

  for (const item of weak) {
    const entry = bestOf(tallyByVendor.get(item.vendorId), item.allowed) || item.allowed[0]
    assignment.set(item.id, entry)
  }

  // A product with no evidence at all joins the shelf the rest of its stand
  // landed on ("Gift wrap" from a fashion stand is fashion, not Other goods).
  for (const p of unresolved) {
    const vendorId = Number(p.vendor_id)
    const entry = bestOf(tallyByVendor.get(vendorId), allowedFor(vendorId)) ||
      bestOf(tallyByVendor.get(vendorId), SHELVES)
    assignment.set(p.id, entry || OTHER)
  }

  const keyOf = new Map()
  const counts = new Map()
  for (const p of products) {
    const entry = assignment.get(p.id) || OTHER
    keyOf.set(p.id, entry.key)
    const existing = counts.get(entry.key)
    if (existing) existing.count += 1
    else counts.set(entry.key, { ...entry, count: 1 })
  }

  const shelves = [...counts.values()].sort((a, b) => {
    // "Other goods" is a leftover, never a headline shelf.
    if (a.key === OTHER.key) return 1
    if (b.key === OTHER.key) return -1
    return b.count - a.count || a.label.localeCompare(b.label)
  })

  return { keyOf, shelves, total: products.length }
}
