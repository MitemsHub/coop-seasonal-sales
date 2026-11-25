// lib/exhibitionShelf.js
// Turns a branch's flat product list into the shelves a member actually shops
// by.
//
// Why this exists: exhibition vendors type their own category names, and most
// of them either leave the field empty or invent something only they use
// ("FOOD STUFF", "Provisions & co"). A chip row built straight from those
// names was therefore mostly empty and always incomplete — the shop could only
// show pills for the handful of products a vendor had bothered to tag.
//
// So every product is sorted into a shelf here, from the strongest evidence
// available and in this order:
//   1. keywords in the product name    (weight 6 — the vendor's own words)
//   2. keywords in the vendor category (weight 4 — their intent)
//   3. keywords in the description/unit(weight 1 — supporting detail)
// A product with no keyword evidence but a real category keeps that category
// as its shelf (title-cased, grouped by category id so two vendors using the
// same category land together); anything left is "Other goods".
//
// Every product therefore lands on exactly one shelf, so the pills always add
// up to the whole shop and no member's product is unreachable.

// Order matters: the first shelf to win on score also wins a tie, so the more
// specific shelves sit above the broad ones (grains before provisions, drinks
// before pantry, phones before general hardware).
const SHELVES = [
  {
    key: 'grains',
    label: 'Grains & Staples',
    icon: 'Wheat',
    words: [
      'rice', 'bean', 'garri', 'garry', 'semo', 'semovita', 'semolina', 'wheat', 'maize', 'corn',
      'millet', 'sorghum', 'guinea corn', 'flour', 'starch', 'cassava', 'elubo', 'fufu', 'tuwo',
      'yam flour', 'plantain flour', 'spaghetti', 'macaroni', 'noodle', 'pasta', 'oat', 'cereal',
      'cornflake', 'golden morn', 'pap', 'akamu', 'couscous', 'breadfruit', 'soya', 'soyabean',
      'soybean', 'quinoa', 'bulgur', 'barley', 'tapioca', 'wheatmeal',
    ],
  },
  {
    key: 'produce',
    label: 'Fresh Produce',
    icon: 'Carrot',
    words: [
      'tomato', 'pepper', 'tatashe', 'rodo', 'shombo', 'onion', 'yam', 'potato', 'plantain',
      'banana', 'orange', 'apple', 'mango', 'pineapple', 'watermelon', 'cucumber', 'carrot',
      'cabbage', 'lettuce', 'vegetable', 'ugu', 'ewedu', 'okra', 'okro', 'spinach', 'garden egg',
      'eggplant', 'avocado', 'pawpaw', 'waterleaf', 'bitter leaf', 'scent leaf', 'efirin', 'lemon',
      'lime', 'grape', 'pear', 'strawberry', 'cocoyam', 'taro', 'shallot', 'spring onion',
      'broccoli', 'cauliflower', 'green bean', 'pea', 'groundnut',
    ],
  },
  {
    key: 'protein',
    label: 'Meat, Fish & Eggs',
    icon: 'Beef',
    words: [
      'chicken', 'turkey', 'beef', 'cow meat', 'goat', 'mutton', 'ram', 'pork', 'fish', 'croaker',
      'titus', 'mackerel', 'catfish', 'tilapia', 'stockfish', 'panla', 'egg', 'gizzard', 'shaki',
      'pomo', 'ponmo', 'kpomo', 'offal', 'snail', 'prawn', 'shrimp', 'crab', 'periwinkle',
      'sausage', 'bacon', 'ham', 'duck', 'quail',
    ],
  },
  {
    key: 'oils',
    label: 'Oils & Seasonings',
    icon: 'Droplets',
    words: [
      'oil', 'palm oil', 'groundnut oil', 'vegetable oil', 'soya oil', 'maggi', 'knorr', 'seasoning',
      'spice', 'curry', 'thyme', 'salt', 'sugar', 'crayfish', 'ogiri', 'iru', 'dawadawa',
      'locust bean', 'nutmeg', 'cinnamon', 'bay leaf', 'ginger', 'garlic', 'cameroon pepper',
      'black pepper', 'white pepper', 'bouillon', 'stock cube', 'vinegar', 'tomato paste',
      'tin tomato', 'pepper paste', 'ketchup', 'mayonnaise', 'mustard', 'soy sauce', 'food colour',
      'baking powder', 'yeast', 'vanilla', 'essence',
    ],
  },
  {
    key: 'drinks',
    label: 'Drinks & Beverages',
    icon: 'Coffee',
    words: [
      'water', 'bottled water', 'table water', 'coke', 'cola', 'coca cola', 'coca-cola', 'fanta',
      'sprite', 'pepsi', 'mirinda', '7up', 'schweppes', 'malt drink',
      'malt', 'maltina', 'juice', 'drink', 'milk', 'peak milk', 'cowbell', 'milo', 'bournvita',
      'ovaltine', 'tea', 'lipton', 'coffee', 'nescafe', 'wine', 'beer', 'champagne', 'whisky',
      'whiskey', 'gin', 'vodka', 'brandy', 'soft drink', 'zobo', 'kunu', 'chapman', 'energy drink',
      'red bull', 'yogurt', 'yoghurt', 'hot chocolate', 'evaporated milk', 'powdered milk',
    ],
  },
  {
    key: 'snacks',
    label: 'Snacks & Bakery',
    icon: 'Cookie',
    words: [
      'biscuit', 'cookie', 'chin chin', 'puff puff', 'puffpuff', 'gala', 'sausage roll', 'meat pie',
      'cake', 'bread', 'agege bread', 'loaf', 'chocolate', 'candy', 'sweet', 'toffee', 'lollipop',
      'kuli kuli', 'plantain chips', 'popcorn', 'wafer', 'cracker', 'doughnut', 'donut', 'snack',
      'cheese ball', 'ice cream', 'crisps', 'chips',
    ],
  },
  {
    key: 'pantry',
    label: 'Provisions',
    icon: 'ShoppingBasket',
    words: [
      'sardine', 'corned beef', 'baked bean', 'tin', 'canned', 'custard', 'noodles', 'jam',
      'peanut butter', 'butter', 'margarine', 'honey', 'sugar', 'salt', 'baked beans',
    ],
  },
  {
    key: 'home',
    label: 'Home & Cleaning',
    icon: 'SprayCan',
    words: [
      'detergent', 'omo', 'soap', 'bar soap', 'bath soap', 'sunlight', 'ariel', 'bleach',
      'hypochlorite', 'izal', 'disinfectant', 'mop', 'broom', 'bucket', 'sponge', 'scrub',
      'toilet roll', 'tissue', 'tissue paper', 'towel', 'air freshener', 'insecticide', 'raid',
      'mosquito', 'coil', 'candle', 'match', 'foil', 'cling film', 'nylon', 'plate', 'cooler',
      'flask', 'pot', 'kettle', 'cup', 'cutlery', 'spoon', 'blender', 'stove', 'cooker', 'gas',
      'cylinder', 'dish rack', 'hanger', 'dustbin', 'trash', 'laundry', 'cookware', 'frying pan',
      'saucepan',
    ],
  },
  {
    key: 'beauty',
    label: 'Beauty & Care',
    icon: 'Flower2',
    words: [
      'cream', 'lotion', 'body cream', 'shea butter', 'vaseline', 'perfume', 'deodorant', 'roll on',
      'toothpaste', 'toothbrush', 'shampoo', 'conditioner', 'hair cream', 'relaxer', 'wig', 'makeup',
      'lipstick', 'powder', 'foundation', 'nail', 'skincare', 'sunblock', 'sanitary pad', 'razor',
      'shaving', 'mirror', 'body spray', 'coconut oil', 'braid', 'weave', 'beads',
    ],
  },
  {
    key: 'fashion',
    label: 'Fashion & Fabric',
    icon: 'Shirt',
    words: [
      'ankara', 'fabric', 'lace', 'aso oke', 'george', 'wrapper', 'cloth', 'shirt', 'trouser',
      'jean', 'dress', 'gown', 'shoe', 'sandal', 'slipper', 'bag', 'handbag', 'cap', 'hat', 'scarf',
      'hijab', 'abaya', 'kaftan', 'agbada', 'jewelry', 'jewellery', 'earring', 'necklace', 'watch',
      'belt', 'socks', 'underwear', 'bra', 'tshirt', 't-shirt', 'polo', 'skirt', 'blouse',
      'sneaker', 'boot', 'loafer', 'suit', 'tie', 'gele', 'bangle', 'ring',
    ],
  },
  {
    key: 'tech',
    label: 'Phones & Power',
    icon: 'Smartphone',
    words: [
      'phone', 'iphone', 'samsung', 'tecno', 'infinix', 'itel', 'android', 'charger', 'cable',
      'earpiece', 'headphone', 'earphone', 'airpod', 'power bank', 'powerbank', 'battery', 'torch',
      'flashlight', 'bulb', 'led', 'extension', 'socket', 'adapter', 'tv', 'television', 'speaker',
      'fan', 'pressing iron', 'microwave', 'generator', 'solar', 'inverter', 'laptop', 'tablet',
      'router', 'modem', 'camera', 'memory card', 'usb', 'bluetooth', 'rechargeable',
    ],
  },
  {
    key: 'baby',
    label: 'Baby & Kids',
    icon: 'Baby',
    words: [
      'baby', 'infant', 'diaper', 'pampers', 'baby food', 'cerelac', 'nutribom', 'toy', 'doll',
      'teddy', 'kid', 'kids', 'children', 'school bag', 'baby wipes', 'wipes', 'feeding bottle',
      'pacifier', 'stroller', 'baby cream',
    ],
  },
  {
    key: 'health',
    label: 'Health & Wellness',
    icon: 'HeartPulse',
    words: [
      'paracetamol', 'malaria', 'antibiotic', 'vitamin', 'supplement', 'capsule', 'syrup',
      'bandage', 'plaster', 'thermometer', 'face mask', 'hand sanitizer', 'sanitizer', 'herbal',
      'pain relief', 'first aid',
    ],
  },
  {
    key: 'farm',
    label: 'Farm & Garden',
    icon: 'Sprout',
    words: [
      'fertiliser', 'fertilizer', 'npk', 'urea', 'seed', 'seedling', 'pesticide', 'herbicide',
      'cutlass', 'hoe', 'shovel', 'wheelbarrow', 'sprayer', 'poultry feed', 'fish feed', 'chick',
      'day old', 'agro', 'manure', 'compost', 'garden', 'planter',
    ],
  },
  {
    key: 'school',
    label: 'School & Office',
    icon: 'BookOpen',
    words: [
      'book', 'notebook', 'exercise book', 'pen', 'pencil', 'biro', 'ruler', 'eraser', 'stapler',
      'a4', 'paper', 'printer', 'envelope', 'file', 'calculator', 'marker', 'crayon', 'textbook',
      'jotter', 'sharpener', 'glue', 'sticky note', 'folder',
    ],
  },
  {
    key: 'hardware',
    label: 'Building & Hardware',
    icon: 'Hammer',
    words: [
      'cement', 'paint', 'nail', 'screw', 'hammer', 'wire', 'pipe', 'tile', 'iron rod', 'plank',
      'plywood', 'sand', 'block', 'plumbing', 'pvc', 'tape', 'drill', 'saw', 'hinge', 'padlock',
      'door', 'window', 'roofing', 'asbestos', 'shelve',
    ],
  },
]

const OTHER = { key: 'other', label: 'Other goods', icon: 'Package' }

export const SHELF_ICONS = [
  'Wheat', 'Carrot', 'Beef', 'Droplets', 'Coffee', 'Cookie', 'ShoppingBasket', 'SprayCan',
  'Flower2', 'Shirt', 'Smartphone', 'Baby', 'HeartPulse', 'Sprout', 'BookOpen', 'Hammer',
  'Package', 'Tags',
]

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// One alternation per shelf, compiled once: testing 400 keywords product by
// product (a 1,000-product branch) would be the slowest thing on the page.
//
// Keywords are ordered longest-first, because a regex alternation takes the
// first branch that fits: "groundnut oil" must be read as the oil it is, not
// as "groundnut" (produce) plus a stray "oil".
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

// How many keywords hit, and how specific the best hit was. "Groundnut oil"
// beating a bare "groundnut" is what keeps the shelves honest.
function scan(text, rx) {
  if (!text) return { count: 0, longest: 0 }
  rx.lastIndex = 0
  let count = 0
  let longest = 0
  let m = rx.exec(text)
  while (m) {
    count += 1
    if (m[0].length > longest) longest = m[0].length
    if (m.index === rx.lastIndex) rx.lastIndex += 1
    m = rx.exec(text)
  }
  return { count, longest }
}

// "FOOD STUFF" / "foodstuff" / "Food  Stuff" all read the same on a pill.
const titleCase = (s) =>
  String(s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())

/**
 * Sort a product list onto shelves.
 * @returns {{ keyOf: Map<number, string>, shelves: Array<{key: string, label: string, icon: string, count: number}>, total: number }}
 */
export function categorizeShelf(products = []) {
  const keyOf = new Map()
  const counts = new Map()

  for (const p of products) {
    const name = String(p?.name || '').toLowerCase()
    const category = String(p?.category_name || '').toLowerCase()
    const detail = `${p?.description || ''} ${p?.unit || ''}`.toLowerCase()

    let best = null
    let bestScore = 0
    for (const shelf of SHELVES) {
      const rx = matcher(shelf.words)
      const n = scan(name, rx)
      const c = scan(category, rx)
      const d = scan(detail, rx)
      const score =
        n.count * 6 + c.count * 4 + d.count +
        n.longest * 2 + c.longest + (d.longest > 0 ? 1 : 0)
      // Strictly greater, so an earlier (more specific) shelf keeps a tie.
      if (score > bestScore) {
        bestScore = score
        best = shelf
      }
    }

    let entry
    if (best && bestScore >= 2) {
      entry = best
    } else if (p?.category_id && p?.category_name) {
      // No keyword we know, but the vendor did categorise it — keep their word.
      entry = { key: `c${p.category_id}`, label: titleCase(p.category_name), icon: 'Tags' }
    } else {
      entry = OTHER
    }

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
