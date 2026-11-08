import type { Category } from './types';

/**
 * Keyword rules used when no store pack and no model is available (the free OCR
 * path), and as a safety net for model output. Order matters: the first match wins.
 */
const RULES: [Category, RegExp][] = [
  ['Fees & Deposits', /\b(deposit|enviro|eco ?fee|recycl|bottle dep|container dep|bag fee|levy)\b/i],
  ['Membership', /\b(membership|member fee|renewal|exec(utive)? upgrade)\b/i],
  ['Fuel', /\b(gas|fuel|unleaded|diesel|premium|regular)\b.*\b(l|litre|liter|gal)\b|\b(unleaded|diesel|fuel)\b/i],
  ['Baby & Pet', /\b(diaper|wipes baby|formula|infant|baby|dog|cat|kitten|puppy|pet|litter|kibble)\b/i],
  ['Meat & Seafood', /\b(chicken|chkn|ckn|brst|thighs?|beef|steak|stk|ground|pork|bacon|ham|lamb|turkey|sausage|salmon|salm|cod|tilapia|haddock|basa|shrimp|shrmp|prawn|tuna steak|fish|fillet|filet|wing|breast|thigh|drumstick|loin|ribs?|veal|bison)\b/i],
  ['Dairy & Eggs', /\b(milk|oat milk|egg|eggs|yogurt|yoghurt|ygrt|yog|cheese|chedd|gouda|swiss|havarti|mozz|feta|parm|brie|butter|btr|cream|kefir|skyr|oikos)\b/i],
  ['Produce', /\b(apples?|honeycrisp|gala|fuji|bananas?|avo|raspbry|bok choy|choy|\w*berr(y|ies)|grapes?|oranges?|lemons?|limes?|mangoe?s?|pears?|peach(es)?|plums?|nectarines?|kiwis?|cherr(y|ies)|melons?|watermelons?|pineapples?|avocados?|tomato(es)?|cucumbers?|cukes?|peppers?|onions?|garlic|ginger|potato(es)?|carrots?|celery|broccoli|cauliflower|spinach|lettuce|romaine|arugula|kale|cabbage|zucchini|eggplant|mushrooms?|asparagus|sprouts?|corn|radish(es)?|herbs?|cilantro|parsley|salad kit|spring mix|greens|fruits?|veg(etable)?s?|figs?|clementines?|mandarine?s?|produce)\b/i],
  ['Bakery', /\b(bread|bagels?|croiss|baguette|bun|buns|roll|rolls|croissant|muffin|tortilla|tortillas|torts|naan|pita|loaf|sourdough|ciabatta|cake|pie|tiramisu|brownie|cookie dough|danish|pastry|palmier)\b/i],
  ['Frozen', /\b(frozen|frz|dumplings?|ice cream|gelato|pizza|fries|popsicle|waffles)\b/i],
  ['Deli & Prepared', /\b(rotisserie|roti|hummus|kimchi|salsa|dip|deli|sushi|ready meal|prepared|lasagna|soup fresh)\b/i],
  ['Beverages', /\b(coffee|cold brew|tea|juice|soda|spark|pop|cola|coke|pepsi|sparkling|water|kombucha|energy drink|sports drink|gatorade|beer|wine|drink|drinks|latte|espresso|k-?cup)\b/i],
  ['Snacks', /\b(chips|crisps|seaweed|trail mix|cracker|crackers|cookie|cookies|candy|chocolate|choc|nuts?|almond|almonds|cashew|pistachio|walnut|peanut|trail mix|popcorn|pretzel|bar|bars|granola|jerky|gummies|snack|munchies|wafers?|stroopwafel|biscoff|dried)\b/i],
  ['Pantry', /\b(rice|jasmine|evoo|chickpeas?|pasta|penne|spaghetti|noodle|flour|sugar|salt|pepper ground|spice|turmeric|oil|olive|vinegar|sauce|ketchup|mustard|mayo|mayonnaise|honey|jam|peanut butter|nut butter|oats|oatmeal|cereal|granola|beans|lentil|chickpea|canned|tuna|soup|broth|stock|paste|pickles?|dills|olives|syrup|baking|yeast|coconut|croutons|seasoning|tabasco)\b/i],
  ['Personal Care', /\b(sunscreen|shampoo|conditioner|body ?wash|soap bar|deodorant|deo|antiperspirant|toothpaste|toothbrush|brush heads|floss|mouthwash|razor|blade|shave|lotion|sunscreen|cleanser|facial|makeup|cotton|tampon|pads|feminine|micellar)\b/i],
  ['Health', /\b(vitamins?|allergy|bandages?|multivit|supplement|probiotic|ibuprofen|acetaminophen|advil|tylenol|allergy|cold|flu|bandage|first aid|pharmacy|rx|prescription|medicine)\b/i],
  ['Household', /\b(paper towels?|bath tissue|pods|tabs|bulbs?|towels? paper|bounty|tissue|toilet|bath tissue|napkin|detergent|laundry|softener|dryer sheet|bleach|cleaner|cleaning|disinfect|lysol|wipes|sponge|sponges|dish|dishwasher|cascade|finish|trash|garbage|bags|foil|wrap|zip|batteries|battery|light bulb|filter|gloves|swiffer|febreze|air ?wick|scent beads?|downy|tide)\b/i],
  ['Clothing', /\b(shirt|tee|t-shirt|pant|pants|jean|jeans|jogger|short|shorts|sweater|hoodie|jacket|sock|socks|underwear|brief|bra|pj|pajama|dress|legging|shoe|boot)\b/i],
  ['Home & Garden', /\b(pillow|blanket|throw|potting|soil|gloves work|work gloves|sheet set|towel bath|bath towel|rug|candle|plant|plants|rose|azalea|perennial|garden|soil|cookware|pan|pot|knife|knives|serving|scale|hanger|storage|bin|wagon|propane|bbq|grill|lamp|decor)\b/i],
  ['Electronics & Toys', /\b(tv|television|laptop|tablet|ipad|iphone|phone|charger|cables?|usb|usb-c|headphone|earbud|airpods|speaker|console|ps5|playstation|xbox|nintendo|switch|game|toy|lego|r\/c|rc car)\b/i],
];

export function categorize(text: string): Category {
  const t = ` ${text.toLowerCase()} `;
  for (const [cat, re] of RULES) if (re.test(t)) return cat;
  return 'Other';
}

/** Expands common receipt abbreviations into something readable, without a model. */
export function readableName(raw: string): string {
  const map: Record<string, string> = {
    ORG: 'Organic', KS: 'Kirkland', CHKN: 'Chicken', CKN: 'Chicken', BNLS: 'Boneless', SKNLS: 'Skinless', 'B/S': 'Boneless skinless',
    GRK: 'Greek', YGRT: 'Yogurt', YOG: 'Yogurt', BTR: 'Butter', CHSE: 'Cheese', CHEDD: 'Cheddar', MOZZ: 'Mozzarella', PARM: 'Parmesan',
    STK: 'Steak', GR: 'Ground', SHRMP: 'Shrimp', SALM: 'Salmon', CUKES: 'Cucumbers', TOM: 'Tomato', PEPR: 'Pepper', WW: 'Whole wheat',
    TORTS: 'Tortillas', FRZ: 'Frozen', PCS: 'Pieces', PK: 'Pack', CT: 'Count', BLN: 'Blend', VEG: 'Vegetable', VEGS: 'Vegetables',
    APP: 'Apples', BRD: 'Bread', LRG: 'Large', SM: 'Small', MED: 'Medium', XL: 'Extra large', ASST: 'Assorted', NAT: 'Natural',
  };
  const words = raw
    .replace(/\*+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((w) => map[w.toUpperCase()] ?? w);
  const s = words.join(' ').toLowerCase();
  return s ? s[0].toUpperCase() + s.slice(1) : raw;
}
