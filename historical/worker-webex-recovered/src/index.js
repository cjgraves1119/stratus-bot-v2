// ── Ported from stratus-ai-bot-gchat (2026-08-19) ──────────────────────────
// Inline quantity scanning preferred a number AFTER a model over the one before
// it, unconditionally. "2 MS130-24 3 MR44 4 MX67C" parsed as 3 / 4 / 4: silently
// wrong quantities on customer quotes.
const INLINE_MODEL_AHEAD = '(?:MR|MS|MX|MV|MT|MG|MA|CW|C8|C9|Z)\\d';
function afterQuantityBelongsToNextModel(after, quantityDigits) {
  if (!quantityDigits) return false;
  const escaped = String(quantityDigits).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^[ \\t]*[X×]?[ \\t]*${escaped}[ \\t]*[X×]?[ \\t]*${INLINE_MODEL_AHEAD}`, 'i').test(after);
}
function inlineModelQuantity(before, after, beforeQty, afterQty) {
  if (afterQty && !(beforeQty && afterQuantityBelongsToNextModel(after, afterQty[1]))) {
    return parseInt(afterQty[1], 10);
  }
  if (beforeQty) return parseInt(beforeQty[1], 10);
  return 1;
}
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/data/prices.json
var prices_default = {
  prices: {
    "LIC-MV-CA7-3Y": {
      list: 199,
      price: 134,
      discount: 42,
      zoho_product_id: "2570562000238971640",
      discount_per_unit: 65,
      discount_pct: 33
    },
    "LIC-VMX-XL-ENT-1Y": {
      list: 6869,
      price: 4619,
      discount: 42,
      zoho_product_id: "2570562000261763097",
      discount_per_unit: 2250,
      discount_pct: 33
    },
    "LIC-MV-CA30-1Y": {
      list: 221,
      price: 149,
      discount: 0.3258,
      zoho_product_id: "2570562000064122203",
      discount_per_unit: 72,
      discount_pct: 33
    },
    "LIC-MX100-SDW-3Y": {
      list: 15234,
      price: 10244,
      discount: 0.3276,
      zoho_product_id: "2570562000034650467",
      discount_per_unit: 4990,
      discount_pct: 33
    },
    "LIC-MX67-SDW-3Y": {
      list: 2184,
      price: 1469,
      discount: 0.3274,
      zoho_product_id: "2570562000034650498",
      discount_per_unit: 715,
      discount_pct: 33
    },
    "LIC-MX60W-ENT-5YR": {
      list: 1084,
      price: 730,
      discount: 0.3266,
      zoho_product_id: "2570562000001277699",
      discount_per_unit: 354,
      discount_pct: 33
    },
    "LIC-MX60-ENT-1YR": {
      list: 263,
      price: 177,
      discount: 0.327,
      zoho_product_id: "2570562000001277687",
      discount_per_unit: 86,
      discount_pct: 33
    },
    "LIC-MS320-48FP-3YR": {
      list: 1248,
      price: 840,
      discount: 0.3269,
      zoho_product_id: "2570562000001259376",
      discount_per_unit: 408,
      discount_pct: 33
    },
    "LIC-MS320-24-1YR": {
      list: 295,
      price: 199,
      discount: 0.3254,
      zoho_product_id: "2570562000001259355",
      discount_per_unit: 96,
      discount_pct: 33
    },
    "LIC-MG51-ENT-3Y": {
      list: 968,
      price: 452,
      discount: 0.5331,
      zoho_product_id: "2570562000154200072",
      discount_per_unit: 516,
      discount_pct: 53
    },
    "LIC-MX84-SDW-3Y": {
      list: 7616,
      price: 5122,
      discount: 0.3275,
      zoho_product_id: "2570562000034650528",
      discount_per_unit: 2494,
      discount_pct: 33
    },
    "LIC-MS22-3YR": {
      list: 531,
      price: 357,
      discount: 0.3277,
      zoho_product_id: "2570562000001259216",
      discount_per_unit: 174,
      discount_pct: 33
    },
    "LIC-MX80-ENT-1YR": {
      list: 1050,
      price: 707,
      discount: 0.3267,
      zoho_product_id: "2570562000001277753",
      discount_per_unit: 343,
      discount_pct: 33
    },
    "LIC-MX600-ENT-3YR": {
      list: 35322,
      price: 23752,
      discount: 0.3276,
      zoho_product_id: "2570562000001097636",
      discount_per_unit: 11570,
      discount_pct: 33
    },
    "LIC-MS220-8-5YR": {
      list: 245,
      price: 148,
      discount: 0.3959,
      zoho_product_id: "2570562000003355067",
      discount_per_unit: 97,
      discount_pct: 40
    },
    "LIC-MS150-24-3Y": {
      list: 389,
      price: 168,
      discount: 0.5681,
      zoho_product_id: "2570562000290228681",
      discount_per_unit: 221,
      discount_pct: 57
    },
    "LIC-MS320-24P-5YR": {
      list: 1219,
      price: 821,
      discount: 0.3265,
      zoho_product_id: "2570562000001259362",
      discount_per_unit: 398,
      discount_pct: 33
    },
    "LIC-MS22P-5YR": {
      list: 884,
      price: 595,
      discount: 0.3269,
      zoho_product_id: "2570562000001259222",
      discount_per_unit: 289,
      discount_pct: 33
    },
    "LIC-MS420-48-1YR": {
      list: 2598,
      price: 1747,
      discount: 0.3276,
      zoho_product_id: "2570562000001277625",
      discount_per_unit: 851,
      discount_pct: 33
    },
    "LIC-MX400-SEC-5YR": {
      list: 58870,
      price: 39586,
      discount: 0.3276,
      zoho_product_id: "2570562000001097622",
      discount_per_unit: 19284,
      discount_pct: 33
    },
    "LIC-MS220-48-3YR": {
      list: 558,
      price: 376,
      discount: 0.3262,
      zoho_product_id: "2570562000001259291",
      discount_per_unit: 182,
      discount_pct: 33
    },
    "LIC-Z3C-ENT-1YR": {
      list: 221,
      price: 133,
      discount: 0.3982,
      zoho_product_id: "2570562000010635035",
      discount_per_unit: 88,
      discount_pct: 40
    },
    "LIC-MX90-SEC-1YR": {
      list: 4200,
      price: 2824,
      discount: 0.3276,
      zoho_product_id: "2570562000001277778",
      discount_per_unit: 1376,
      discount_pct: 33
    },
    "LIC-MS320-24-3YR": {
      list: 664,
      price: 447,
      discount: 0.3268,
      zoho_product_id: "2570562000001259356",
      discount_per_unit: 217,
      discount_pct: 33
    },
    "LIC-MS320-48-5YR": {
      list: 1637,
      price: 1101,
      discount: 0.3274,
      zoho_product_id: "2570562000001259367",
      discount_per_unit: 536,
      discount_pct: 33
    },
    "LIC-MS320-48-3YR": {
      list: 982,
      price: 661,
      discount: 0.3269,
      zoho_product_id: "2570562000001259366",
      discount_per_unit: 321,
      discount_pct: 33
    },
    "LIC-MS150-24-5Y": {
      list: 648,
      price: 280,
      discount: 0.5679,
      zoho_product_id: "2570562000290228718",
      discount_per_unit: 368,
      discount_pct: 57
    },
    "LIC-MS220-24-1YR": {
      list: 141,
      price: 95,
      discount: 0.3262,
      zoho_product_id: "2570562000001259280",
      discount_per_unit: 46,
      discount_pct: 33
    },
    "LIC-MS220-8-1YR": {
      list: 65,
      price: 40,
      discount: 0.3846,
      zoho_product_id: "2570562000003355065",
      discount_per_unit: 25,
      discount_pct: 38
    },
    "LIC-MX100-ENT-3YR": {
      list: 5518,
      price: 3711,
      discount: 0.3275,
      zoho_product_id: "2570562000001097596",
      discount_per_unit: 1807,
      discount_pct: 33
    },
    "LIC-Z1-ENT-3YR": {
      list: 110,
      price: 70,
      discount: 0.3636,
      zoho_product_id: "2570562000001097479",
      discount_per_unit: 40,
      discount_pct: 36
    },
    "LIC-MX600-ENT-5YR": {
      list: 58870,
      price: 39586,
      discount: 0.3276,
      zoho_product_id: "2570562000001097637",
      discount_per_unit: 19284,
      discount_pct: 33
    },
    "LIC-MX60W-ENT-3YR": {
      list: 650,
      price: 438,
      discount: 0.3262,
      zoho_product_id: "2570562000001277698",
      discount_per_unit: 212,
      discount_pct: 33
    },
    "LIC-MS320-24P-1YR": {
      list: 325,
      price: 220,
      discount: 0.3231,
      zoho_product_id: "2570562000001259360",
      discount_per_unit: 105,
      discount_pct: 32
    },
    "LIC-MX70-SEC-1YR": {
      list: 1e3,
      price: 660,
      discount: 0.34,
      zoho_product_id: "2570562000001277750",
      discount_per_unit: 340,
      discount_pct: 34
    },
    "LIC-MX70-ENT-3YR": {
      list: 1e3,
      price: 660,
      discount: 0.34,
      zoho_product_id: "2570562000001277748",
      discount_per_unit: 340,
      discount_pct: 34
    },
    "LIC-MR-UPGR-3Y": {
      list: 452,
      price: 305,
      discount: 0.3252,
      zoho_product_id: "2570562000022573147",
      discount_per_unit: 147,
      discount_pct: 33
    },
    "LIC-Z4C-SEC-3Y": {
      list: 1154,
      price: 777,
      discount: 0.3267,
      zoho_product_id: "2570562000198467610",
      discount_per_unit: 377,
      discount_pct: 33
    },
    "LIC-MG51-ENT-5Y": {
      list: 1611,
      price: 751,
      discount: 0.5338,
      zoho_product_id: "2570562000154200073",
      discount_per_unit: 860,
      discount_pct: 53
    },
    "LIC-DISPLAY-5Y": {
      list: 1253,
      price: 844,
      discount: 0.3264,
      zoho_product_id: "2570562000153312104",
      discount_per_unit: 409,
      discount_pct: 33
    },
    "LIC-MS120-48-3YR": {
      list: 439,
      price: 185,
      discount: 0.5786,
      zoho_product_id: "2570562000001259261",
      discount_per_unit: 254,
      discount_pct: 58
    },
    "LIC-MR-UPGR-1Y": {
      list: 201,
      price: 136,
      discount: 0.3234,
      zoho_product_id: "2570562000022573148",
      discount_per_unit: 65,
      discount_pct: 32
    },
    "LIC-MS130-48A-5Y": {
      list: 2243,
      price: 587,
      discount: 0.7383,
      zoho_product_id: "2570562000261763045",
      discount_per_unit: 1656,
      discount_pct: 74
    },
    "LIC-MS120-8-5YR": {
      list: 177,
      price: 75,
      discount: 0.5763,
      zoho_product_id: "2570562000001259237",
      discount_per_unit: 102,
      discount_pct: 58
    },
    "LIC-MX68-ENT-1YR": {
      list: 368,
      price: 231,
      discount: 0.3723,
      zoho_product_id: "2570562000010635054",
      discount_per_unit: 137,
      discount_pct: 37
    },
    "LIC-MX60W-SEC-5YR": {
      list: 2164,
      price: 1455,
      discount: 0.3276,
      zoho_product_id: "2570562000001277704",
      discount_per_unit: 709,
      discount_pct: 33
    },
    "LIC-MS220-8P-1YR": {
      list: 82,
      price: 51,
      discount: 0.378,
      zoho_product_id: "2570562000003355070",
      discount_per_unit: 31,
      discount_pct: 38
    },
    "LIC-MS220-24-3YR": {
      list: 318,
      price: 215,
      discount: 0.3239,
      zoho_product_id: "2570562000001259281",
      discount_per_unit: 103,
      discount_pct: 32
    },
    "LIC-MX65-ENT-3YR": {
      list: 719,
      price: 451,
      discount: 0.3727,
      zoho_product_id: "2570562000001097540",
      discount_per_unit: 268,
      discount_pct: 37
    },
    "LIC-MS410-32-5YR": {
      list: 3899,
      price: 2622,
      discount: 0.3275,
      zoho_product_id: "2570562000001094235",
      discount_per_unit: 1277,
      discount_pct: 33
    },
    "LIC-MX65-SEC-3YR": {
      list: 1436,
      price: 900,
      discount: 0.3733,
      zoho_product_id: "2570562000001097545",
      discount_per_unit: 536,
      discount_pct: 37
    },
    "LIC-MX65-ENT-5YR": {
      list: 1197,
      price: 751,
      discount: 0.3726,
      zoho_product_id: "2570562000001097541",
      discount_per_unit: 446,
      discount_pct: 37
    },
    "LIC-MS410-16-1YR": {
      list: 591,
      price: 398,
      discount: 0.3266,
      zoho_product_id: "2570562000001094228",
      discount_per_unit: 193,
      discount_pct: 33
    },
    "LIC-MX65W-ENT-1YR": {
      list: 392,
      price: 246,
      discount: 0.3724,
      zoho_product_id: "2570562000001097549",
      discount_per_unit: 146,
      discount_pct: 37
    },
    "LIC-MX65W-SEC-5YR": {
      list: 2943,
      price: 1845,
      discount: 0.3731,
      zoho_product_id: "2570562000001097556",
      discount_per_unit: 1098,
      discount_pct: 37
    },
    "LIC-MS410-16-3YR": {
      list: 1330,
      price: 894,
      discount: 0.3278,
      zoho_product_id: "2570562000001094229",
      discount_per_unit: 436,
      discount_pct: 33
    },
    "LIC-Z4-ENT-5Y": {
      list: 753,
      price: 394,
      discount: 0.4768,
      zoho_product_id: "2570562000161357198",
      discount_per_unit: 359,
      discount_pct: 48
    },
    "LIC-MS130-24A-1Y": {
      list: 346,
      price: 91,
      discount: 0.737,
      zoho_product_id: "2570562000261763047",
      discount_per_unit: 255,
      discount_pct: 74
    },
    "LIC-MS130-24A-5Y": {
      list: 1296,
      price: 339,
      discount: 0.7384,
      zoho_product_id: "2570562000261763048",
      discount_per_unit: 957,
      discount_pct: 74
    },
    "LIC-MS130-48A-1Y": {
      list: 597,
      price: 156,
      discount: 0.7387,
      zoho_product_id: "2570562000261763049",
      discount_per_unit: 441,
      discount_pct: 74
    },
    "LIC-MS130-CMPTA-5Y": {
      list: 500,
      price: 131,
      discount: 0.738,
      zoho_product_id: "2570562000261763050",
      discount_per_unit: 369,
      discount_pct: 74
    },
    "LIC-C9350-48A-5Y": {
      list: 9467,
      price: 6366,
      discount: 41,
      zoho_product_id: "2570562000349456651",
      discount_per_unit: 3101,
      discount_pct: 33
    },
    "LIC-C9350-48E-3Y": {
      list: 2533,
      price: 1703,
      discount: 42,
      zoho_product_id: "2570562000349456653",
      discount_per_unit: 830,
      discount_pct: 33
    },
    "LIC-C9350-48E-5Y": {
      list: 4221,
      price: 2839,
      discount: 41,
      zoho_product_id: "2570562000349456654",
      discount_per_unit: 1382,
      discount_pct: 33
    },
    "LIC-MX65-SEC-1YR": {
      list: 638,
      price: 400,
      discount: 0.373,
      zoho_product_id: "2570562000001097544",
      discount_per_unit: 238,
      discount_pct: 37
    },
    "LIC-MS410-32-1YR": {
      list: 1040,
      price: 700,
      discount: 0.3269,
      zoho_product_id: "2570562000001094233",
      discount_per_unit: 340,
      discount_pct: 33
    },
    "LIC-MX65-SEC-5YR": {
      list: 2393,
      price: 1500,
      discount: 0.3732,
      zoho_product_id: "2570562000001097546",
      discount_per_unit: 893,
      discount_pct: 37
    },
    "LIC-MX65W-SEC-3YR": {
      list: 1766,
      price: 1107,
      discount: 0.3732,
      zoho_product_id: "2570562000001097555",
      discount_per_unit: 659,
      discount_pct: 37
    },
    "LIC-MX65-ENT-1YR": {
      list: 319,
      price: 200,
      discount: 0.373,
      zoho_product_id: "2570562000001097539",
      discount_per_unit: 119,
      discount_pct: 37
    },
    "LIC-C9300-48E-1Y": {
      list: 1375,
      price: 830,
      discount: 0.3964,
      zoho_product_id: "2570562000199758028",
      discount_per_unit: 545,
      discount_pct: 40
    },
    "LIC-MG52-ENT-3Y": {
      list: 1017,
      price: 684,
      discount: 0.3274,
      zoho_product_id: "2570562000239922050",
      discount_per_unit: 333,
      discount_pct: 33
    },
    "LIC-MV-MULTCAM-1Y": {
      list: 669,
      price: 451,
      discount: 0.3259,
      zoho_product_id: "2570562000316213695",
      discount_per_unit: 218,
      discount_pct: 33
    },
    "LIC-MV-MULTCAM-3Y": {
      list: 1505,
      price: 1013,
      discount: 0.3269,
      zoho_product_id: "2570562000316213696",
      discount_per_unit: 492,
      discount_pct: 33
    },
    "LIC-MV-MULTCAM-5Y": {
      list: 2509,
      price: 1687,
      discount: 0.3276,
      zoho_product_id: "2570562000310723354",
      discount_per_unit: 822,
      discount_pct: 33
    },
    "LIC-MX65W-ENT-3YR": {
      list: 883,
      price: 554,
      discount: 0.3726,
      zoho_product_id: "2570562000001097550",
      discount_per_unit: 329,
      discount_pct: 37
    },
    "LIC-MX65W-SEC-1YR": {
      list: 785,
      price: 492,
      discount: 0.3732,
      zoho_product_id: "2570562000001097554",
      discount_per_unit: 293,
      discount_pct: 37
    },
    "LIC-Z3C-ENT-5YR": {
      list: 828,
      price: 500,
      discount: 0.3961,
      zoho_product_id: "2570562000010635037",
      discount_per_unit: 328,
      discount_pct: 40
    },
    "LIC-MX64W-SDW-1Y": {
      list: 1177,
      price: 792,
      discount: 0.3271,
      zoho_product_id: "2570562000034650486",
      discount_per_unit: 385,
      discount_pct: 33
    },
    "LIC-MV-CA365-1Y": {
      list: 2208,
      price: 1485,
      discount: 0.3274,
      zoho_product_id: "2570562000099103284",
      discount_per_unit: 723,
      discount_pct: 33
    },
    "LIC-MS210-24-3YR": {
      list: 452,
      price: 195,
      discount: 0.5686,
      zoho_product_id: "2570562000001647063",
      discount_per_unit: 257,
      discount_pct: 57
    },
    "LIC-MX65W-ENT-5YR": {
      list: 1471,
      price: 922,
      discount: 0.3732,
      zoho_product_id: "2570562000001097551",
      discount_per_unit: 549,
      discount_pct: 37
    },
    "LIC-MS410-16-5YR": {
      list: 2217,
      price: 1491,
      discount: 0.3275,
      zoho_product_id: "2570562000001094230",
      discount_per_unit: 726,
      discount_pct: 33
    },
    "LIC-MS410-32-3YR": {
      list: 2339,
      price: 1574,
      discount: 0.3271,
      zoho_product_id: "2570562000001094234",
      discount_per_unit: 765,
      discount_pct: 33
    },
    "LIC-C9350-24A-3Y": {
      list: 3039,
      price: 2044,
      discount: 41,
      zoho_product_id: "2570562000349456656",
      discount_per_unit: 995,
      discount_pct: 33
    },
    "LIC-C9350-24A-5Y": {
      list: 5065,
      price: 3406,
      discount: 41,
      zoho_product_id: "2570562000349456657",
      discount_per_unit: 1659,
      discount_pct: 33
    },
    "LIC-C9350-24E-3Y": {
      list: 1375,
      price: 925,
      discount: 42,
      zoho_product_id: "2570562000349456659",
      discount_per_unit: 450,
      discount_pct: 33
    },
    "LIC-C9350-24E-5Y": {
      list: 2291,
      price: 1541,
      discount: 41,
      zoho_product_id: "2570562000349456660",
      discount_per_unit: 750,
      discount_pct: 33
    },
    "LIC-C9350-48A-3Y": {
      list: 5680,
      price: 3820,
      discount: 41,
      zoho_product_id: "2570562000349456662",
      discount_per_unit: 1860,
      discount_pct: 33
    },
    "LIC-MX60-ENT-5YR": {
      list: 986,
      price: 664,
      discount: 0.3266,
      zoho_product_id: "2570562000001277689",
      discount_per_unit: 322,
      discount_pct: 33
    },
    "LIC-MS120-24-3YR": {
      list: 240,
      price: 101,
      discount: 0.5792,
      zoho_product_id: "2570562000001259251",
      discount_per_unit: 139,
      discount_pct: 58
    },
    "LIC-MT-1Y": {
      list: 130,
      price: 68,
      discount: 0.4769,
      zoho_product_id: "2570562000042284055",
      discount_per_unit: 62,
      discount_pct: 48
    },
    "LIC-MT-3Y": {
      list: 301,
      price: 154,
      discount: 0.4884,
      zoho_product_id: "2570562000041876814",
      discount_per_unit: 147,
      discount_pct: 49
    },
    "LIC-MT-5Y": {
      list: 502,
      price: 257,
      discount: 0.488,
      zoho_product_id: "2570562000042284053",
      discount_per_unit: 245,
      discount_pct: 49
    },
    "LIC-MX75-ENT-5Y": {
      list: 3131,
      price: 1962,
      discount: 0.3734,
      zoho_product_id: "2570562000064739380",
      discount_per_unit: 1169,
      discount_pct: 37
    },
    "LIC-MX75-ENT-3Y": {
      list: 1879,
      price: 1177,
      discount: 0.3736,
      zoho_product_id: "2570562000064739379",
      discount_per_unit: 702,
      discount_pct: 37
    },
    "LIC-MS390-48A-3Y": {
      list: 6577,
      price: 3214,
      discount: 0.5113,
      zoho_product_id: "2570562000025231461",
      discount_per_unit: 3363,
      discount_pct: 51
    },
    "LIC-MS130-24A-3Y": {
      list: 778,
      price: 203,
      discount: 0.7391,
      zoho_product_id: "2570562000261763043",
      discount_per_unit: 575,
      discount_pct: 74
    },
    "LIC-MS210-24P-3YR": {
      list: 558,
      price: 241,
      discount: 0.5681,
      zoho_product_id: "2570562000001647068",
      discount_per_unit: 317,
      discount_pct: 57
    },
    "LIC-MS210-48FP-5YR": {
      list: 1637,
      price: 706,
      discount: 0.5687,
      zoho_product_id: "2570562000001647084",
      discount_per_unit: 931,
      discount_pct: 57
    },
    "LIC-MS210-48FP-3YR": {
      list: 982,
      price: 424,
      discount: 0.5682,
      zoho_product_id: "2570562000001647083",
      discount_per_unit: 558,
      discount_pct: 57
    },
    "LIC-MS210-24P-5YR": {
      list: 929,
      price: 401,
      discount: 0.5684,
      zoho_product_id: "2570562000001647069",
      discount_per_unit: 528,
      discount_pct: 57
    },
    "LIC-MS320-48LP-5YR": {
      list: 1905,
      price: 1282,
      discount: 0.327,
      zoho_product_id: "2570562000001259372",
      discount_per_unit: 623,
      discount_pct: 33
    },
    "LIC-MX60W-SEC-3YR": {
      list: 1299,
      price: 874,
      discount: 0.3272,
      zoho_product_id: "2570562000001277703",
      discount_per_unit: 425,
      discount_pct: 33
    },
    "LIC-MX400-SEC-3YR": {
      list: 35322,
      price: 23752,
      discount: 0.3276,
      zoho_product_id: "2570562000001097621",
      discount_per_unit: 11570,
      discount_pct: 33
    },
    "LIC-MS210-48-5YR": {
      list: 1152,
      price: 498,
      discount: 0.5677,
      zoho_product_id: "2570562000001647074",
      discount_per_unit: 654,
      discount_pct: 57
    },
    "LIC-MS390-24A-5Y": {
      list: 5935,
      price: 2900,
      discount: 0.5114,
      zoho_product_id: "2570562000025231468",
      discount_per_unit: 3035,
      discount_pct: 51
    },
    "LIC-MS125-48LP-5Y": {
      list: 1129,
      price: 475,
      discount: 0.5793,
      zoho_product_id: "2570562000019405057",
      discount_per_unit: 654,
      discount_pct: 58
    },
    "LIC-C9300-48E-5Y": {
      list: 4331,
      price: 2614,
      discount: 0.3964,
      zoho_product_id: "2570562000199758010",
      discount_per_unit: 1717,
      discount_pct: 40
    },
    "LIC-MX50-ENT-3YR": {
      list: 1e3,
      price: 673,
      discount: 42,
      discount_per_unit: 327,
      discount_pct: 33
    },
    "LIC-MX80-ENT-5YR": {
      list: 3937,
      price: 2647,
      discount: 0.3277,
      zoho_product_id: "2570562000001277755",
      discount_per_unit: 1290,
      discount_pct: 33
    },
    "LIC-MX400-ENT-1YR": {
      list: 7849,
      price: 5278,
      discount: 0.3276,
      zoho_product_id: "2570562000001097615",
      discount_per_unit: 2571,
      discount_pct: 33
    },
    "LIC-DISPLAY-3Y": {
      list: 752,
      price: 506,
      discount: 0.3271,
      zoho_product_id: "2570562000180186023",
      discount_per_unit: 246,
      discount_pct: 33
    },
    "LIC-MS320-48LP-3YR": {
      list: 1143,
      price: 769,
      discount: 0.3272,
      zoho_product_id: "2570562000001259371",
      discount_per_unit: 374,
      discount_pct: 33
    },
    "LIC-MX50-ENT-1YR": {
      list: 500,
      price: 337,
      discount: 42,
      discount_per_unit: 163,
      discount_pct: 33
    },
    "LIC-MX600-SEC-1YR": {
      list: 31399,
      price: 21114,
      discount: 0.3276,
      zoho_product_id: "2570562000001097640",
      discount_per_unit: 10285,
      discount_pct: 33
    },
    "LIC-MS120-48LP-5YR": {
      list: 974,
      price: 409,
      discount: 0.5801,
      zoho_product_id: "2570562000001259267",
      discount_per_unit: 565,
      discount_pct: 58
    },
    "LIC-MS42-3YR": {
      list: 531,
      price: 357,
      discount: 0.3277,
      zoho_product_id: "2570562000001259226",
      discount_per_unit: 174,
      discount_pct: 33
    },
    "LIC-MG21-ENT-5Y": {
      list: 884,
      price: 595,
      discount: 0.3269,
      zoho_product_id: "2570562000025231456",
      discount_per_unit: 289,
      discount_pct: 33
    },
    "LIC-MS120-8LP-5YR": {
      list: 222,
      price: 93,
      discount: 0.5811,
      zoho_product_id: "2570562000001259242",
      discount_per_unit: 129,
      discount_pct: 58
    },
    "LIC-MS220-48-1YR": {
      list: 248,
      price: 167,
      discount: 0.3266,
      zoho_product_id: "2570562000001259290",
      discount_per_unit: 81,
      discount_pct: 33
    },
    "LIC-MS42P-5YR": {
      list: 884,
      price: 595,
      discount: 0.3269,
      zoho_product_id: "2570562000001259232",
      discount_per_unit: 289,
      discount_pct: 33
    },
    "LIC-MS22-1YR": {
      list: 236,
      price: 159,
      discount: 0.3263,
      zoho_product_id: "2570562000001259215",
      discount_per_unit: 77,
      discount_pct: 33
    },
    "LIC-MX60-SEC-1YR": {
      list: 525,
      price: 354,
      discount: 0.3257,
      zoho_product_id: "2570562000001277692",
      discount_per_unit: 171,
      discount_pct: 33
    },
    "LIC-MS120-8FP-5YR": {
      list: 290,
      price: 122,
      discount: 0.5793,
      zoho_product_id: "2570562000001259247",
      discount_per_unit: 168,
      discount_pct: 58
    },
    "LIC-MG41-ENT-1Y": {
      list: 473,
      price: 318,
      discount: 0.3277,
      zoho_product_id: "2570562000064739438",
      discount_per_unit: 155,
      discount_pct: 33
    },
    "LIC-MS130-CMPTA-1Y": {
      list: 135,
      price: 36,
      discount: 0.7333,
      zoho_product_id: "2570562000261763044",
      discount_per_unit: 99,
      discount_pct: 73
    },
    "LIC-MX85-SEC-1Y": {
      list: 2453,
      price: 1649,
      discount: 0.3278,
      zoho_product_id: "2570562000064739398",
      discount_per_unit: 804,
      discount_pct: 33
    },
    "LIC-MS210-48-3YR": {
      list: 691,
      price: 299,
      discount: 0.5673,
      zoho_product_id: "2570562000001647073",
      discount_per_unit: 392,
      discount_pct: 57
    },
    "LIC-MS450-12-1YR": {
      list: 1464,
      price: 985,
      discount: 0.3272,
      zoho_product_id: "2570562000017212212",
      discount_per_unit: 479,
      discount_pct: 33
    },
    "LIC-MS120-8-1YR": {
      list: 47,
      price: 21,
      discount: 0.5532,
      zoho_product_id: "2570562000001259235",
      discount_per_unit: 26,
      discount_pct: 55
    },
    "LIC-MS120-8FP-3YR": {
      list: 174,
      price: 74,
      discount: 0.5747,
      zoho_product_id: "2570562000001259246",
      discount_per_unit: 100,
      discount_pct: 57
    },
    "LIC-MS120-48-1YR": {
      list: 195,
      price: 83,
      discount: 0.5744,
      zoho_product_id: "2570562000001259260",
      discount_per_unit: 112,
      discount_pct: 57
    },
    "LIC-MX68-SEC-3YR": {
      list: 1655,
      price: 885,
      discount: 0.4653,
      zoho_product_id: "2570562000010523434",
      discount_per_unit: 770,
      discount_pct: 47
    },
    "LIC-MS120-8FP-1YR": {
      list: 77,
      price: 33,
      discount: 0.5714,
      zoho_product_id: "2570562000001259245",
      discount_per_unit: 44,
      discount_pct: 57
    },
    "LIC-MX68CW-ENT-1YR": {
      list: 515,
      price: 270,
      discount: 0.4757,
      zoho_product_id: "2570562000010635063",
      discount_per_unit: 245,
      discount_pct: 48
    },
    "LIC-MG41-ENT-5Y": {
      list: 1772,
      price: 1192,
      discount: 0.3273,
      zoho_product_id: "2570562000064739440",
      discount_per_unit: 580,
      discount_pct: 33
    },
    "LIC-MS120-24P-5YR": {
      list: 643,
      price: 270,
      discount: 0.5801,
      zoho_product_id: "2570562000001259257",
      discount_per_unit: 373,
      discount_pct: 58
    },
    "LIC-MS390-48E-5Y": {
      list: 4674,
      price: 2284,
      discount: 0.5113,
      zoho_product_id: "2570562000025231478",
      discount_per_unit: 2390,
      discount_pct: 51
    },
    "LIC-MS390-24E-5Y": {
      list: 2604,
      price: 1272,
      discount: 0.5115,
      zoho_product_id: "2570562000025231477",
      discount_per_unit: 1332,
      discount_pct: 51
    },
    "LIC-MS390-48E-1Y": {
      list: 1246,
      price: 609,
      discount: 0.5112,
      zoho_product_id: "2570562000025231467",
      discount_per_unit: 637,
      discount_pct: 51
    },
    "LIC-MS390-24E-1Y": {
      list: 694,
      price: 340,
      discount: 0.5101,
      zoho_product_id: "2570562000025231479",
      discount_per_unit: 354,
      discount_pct: 51
    },
    "LIC-MS120-8LP-3YR": {
      list: 133,
      price: 56,
      discount: 0.5789,
      zoho_product_id: "2570562000001259241",
      discount_per_unit: 77,
      discount_pct: 58
    },
    "LIC-MS120-24-1YR": {
      list: 106,
      price: 45,
      discount: 0.5755,
      zoho_product_id: "2570562000001259250",
      discount_per_unit: 61,
      discount_pct: 58
    },
    "LIC-MX67-ENT-1YR": {
      list: 343,
      price: 216,
      discount: 0.3703,
      zoho_product_id: "2570562000010635041",
      discount_per_unit: 127,
      discount_pct: 37
    },
    "LIC-MS120-24-5YR": {
      list: 399,
      price: 168,
      discount: 0.5789,
      zoho_product_id: "2570562000001259252",
      discount_per_unit: 231,
      discount_pct: 58
    },
    "LIC-MS120-24P-1YR": {
      list: 172,
      price: 72,
      discount: 0.5814,
      zoho_product_id: "2570562000001259255",
      discount_per_unit: 100,
      discount_pct: 58
    },
    "LIC-MS120-48LP-1YR": {
      list: 260,
      price: 109,
      discount: 0.5808,
      zoho_product_id: "2570562000001259265",
      discount_per_unit: 151,
      discount_pct: 58
    },
    "LIC-MV-1YR": {
      list: 330,
      price: 189,
      discount: 0.4273,
      zoho_product_id: "2570562000001097466",
      discount_per_unit: 141,
      discount_pct: 43
    },
    "LIC-MS225-48LP-5YR": {
      list: 1931,
      price: 833,
      discount: 0.5686,
      zoho_product_id: "2570562000001094140",
      discount_per_unit: 1098,
      discount_pct: 57
    },
    "LIC-C9300-48A-1Y": {
      list: 3646,
      price: 2201,
      discount: 0.3963,
      zoho_product_id: "2570562000201429208",
      discount_per_unit: 1445,
      discount_pct: 40
    },
    "LIC-C9300-24A-5Y": {
      list: 6415,
      price: 3871,
      discount: 0.3966,
      zoho_product_id: "2570562000201429209",
      discount_per_unit: 2544,
      discount_pct: 40
    },
    "LIC-MS250-48LP-1YR": {
      list: 713,
      price: 349,
      discount: 0.5105,
      zoho_product_id: "2570562000001094163",
      discount_per_unit: 364,
      discount_pct: 51
    },
    "LIC-MS250-48FP-5YR": {
      list: 2905,
      price: 1420,
      discount: 0.5112,
      zoho_product_id: "2570562000001094170",
      discount_per_unit: 1485,
      discount_pct: 51
    },
    "LIC-MS225-24-5YR": {
      list: 1163,
      price: 502,
      discount: 0.5684,
      zoho_product_id: "2570562000001094125",
      discount_per_unit: 661,
      discount_pct: 57
    },
    "LIC-MS225-48FP-3YR": {
      list: 1299,
      price: 560,
      discount: 0.5689,
      zoho_product_id: "2570562000001094144",
      discount_per_unit: 739,
      discount_pct: 57
    },
    "LIC-MX450-ENT-1YR": {
      list: 9812,
      price: 6599,
      discount: 0.3275,
      zoho_product_id: "2570562000001097625",
      discount_per_unit: 3213,
      discount_pct: 33
    },
    "LIC-MS225-48LP-3YR": {
      list: 1158,
      price: 500,
      discount: 0.5682,
      zoho_product_id: "2570562000001094139",
      discount_per_unit: 658,
      discount_pct: 57
    },
    "LIC-MS225-24-1YR": {
      list: 310,
      price: 134,
      discount: 0.5677,
      zoho_product_id: "2570562000001094123",
      discount_per_unit: 176,
      discount_pct: 57
    },
    "LIC-MS225-24-3YR": {
      list: 697,
      price: 301,
      discount: 0.5681,
      zoho_product_id: "2570562000001094124",
      discount_per_unit: 396,
      discount_pct: 57
    },
    "LIC-MS250-24P-3YR": {
      list: 1089,
      price: 532,
      discount: 0.5115,
      zoho_product_id: "2570562000001094154",
      discount_per_unit: 557,
      discount_pct: 51
    },
    "LIC-MX68W-SDW-1Y": {
      list: 1472,
      price: 770,
      discount: 0.4769,
      zoho_product_id: "2570562000034650522",
      discount_per_unit: 702,
      discount_pct: 48
    },
    "LIC-MX75-SEC-1Y": {
      list: 1661,
      price: 774,
      discount: 0.534,
      zoho_product_id: "2570562000064739383",
      discount_per_unit: 887,
      discount_pct: 53
    },
    "LIC-MX68CW-ENT-3YR": {
      list: 1158,
      price: 606,
      discount: 0.4767,
      zoho_product_id: "2570562000010635064",
      discount_per_unit: 552,
      discount_pct: 48
    },
    "LIC-MS225-48-5YR": {
      list: 1604,
      price: 692,
      discount: 0.5686,
      zoho_product_id: "2570562000001094135",
      discount_per_unit: 912,
      discount_pct: 57
    },
    "LIC-MV-3YR": {
      list: 752,
      price: 429,
      discount: 0.4295,
      zoho_product_id: "2570562000001097467",
      discount_per_unit: 323,
      discount_pct: 43
    },
    "LIC-MS225-48FP-5YR": {
      list: 2164,
      price: 933,
      discount: 0.5689,
      zoho_product_id: "2570562000001094145",
      discount_per_unit: 1231,
      discount_pct: 57
    },
    "LIC-MS225-24P-5YR": {
      list: 1348,
      price: 582,
      discount: 0.5682,
      zoho_product_id: "2570562000001094130",
      discount_per_unit: 766,
      discount_pct: 57
    },
    "LIC-MS250-48FP-1YR": {
      list: 775,
      price: 379,
      discount: 0.511,
      zoho_product_id: "2570562000001094168",
      discount_per_unit: 396,
      discount_pct: 51
    },
    "LIC-MS250-48FP-3YR": {
      list: 1743,
      price: 852,
      discount: 0.5112,
      zoho_product_id: "2570562000001094169",
      discount_per_unit: 891,
      discount_pct: 51
    },
    "LIC-MV-5YR": {
      list: 1253,
      price: 714,
      discount: 0.4302,
      zoho_product_id: "2570562000001097468",
      discount_per_unit: 539,
      discount_pct: 43
    },
    "LIC-MS225-48-1YR": {
      list: 427,
      price: 185,
      discount: 0.5667,
      zoho_product_id: "2570562000001094133",
      discount_per_unit: 242,
      discount_pct: 57
    },
    "LIC-MS250-24P-1YR": {
      list: 484,
      price: 237,
      discount: 0.5103,
      zoho_product_id: "2570562000001094153",
      discount_per_unit: 247,
      discount_pct: 51
    },
    "LIC-MX68W-SEC-3YR": {
      list: 1987,
      price: 1040,
      discount: 0.4766,
      zoho_product_id: "2570562000010523065",
      discount_per_unit: 947,
      discount_pct: 48
    },
    "LIC-MX68W-ENT-1YR": {
      list: 442,
      price: 231,
      discount: 0.4774,
      zoho_product_id: "2570562000010635058",
      discount_per_unit: 211,
      discount_pct: 48
    },
    "LIC-MS250-48-1YR": {
      list: 620,
      price: 303,
      discount: 0.5113,
      zoho_product_id: "2570562000001094158",
      discount_per_unit: 317,
      discount_pct: 51
    },
    "LIC-MS250-24P-5YR": {
      list: 1814,
      price: 887,
      discount: 0.511,
      zoho_product_id: "2570562000001094155",
      discount_per_unit: 927,
      discount_pct: 51
    },
    "LIC-MX67C-SDW-5Y": {
      list: 5337,
      price: 2485,
      discount: 0.5344,
      zoho_product_id: "2570562000034650504",
      discount_per_unit: 2852,
      discount_pct: 53
    },
    "LIC-MS220-48LP-3YR": {
      list: 746,
      price: 502,
      discount: 0.3271,
      zoho_product_id: "2570562000001259296",
      discount_per_unit: 244,
      discount_pct: 33
    },
    "LIC-MX67W-SDW-3Y": {
      list: 2303,
      price: 1205,
      discount: 0.4768,
      zoho_product_id: "2570562000034650508",
      discount_per_unit: 1098,
      discount_pct: 48
    },
    "LIC-MX60-SEC-5YR": {
      list: 1968,
      price: 1324,
      discount: 0.3272,
      zoho_product_id: "2570562000001277694",
      discount_per_unit: 644,
      discount_pct: 33
    },
    "LIC-MS320-48FP-5YR": {
      list: 2081,
      price: 1400,
      discount: 0.3272,
      zoho_product_id: "2570562000001259377",
      discount_per_unit: 681,
      discount_pct: 33
    },
    "LIC-MS320-24P-3YR": {
      list: 732,
      price: 492,
      discount: 0.3279,
      zoho_product_id: "2570562000001259361",
      discount_per_unit: 240,
      discount_pct: 33
    },
    "LIC-MX-SDW-S-3Y": {
      list: 1340,
      price: 901,
      discount: 42,
      zoho_product_id: "2570562000261763081",
      discount_per_unit: 439,
      discount_pct: 33
    },
    "LIC-MX-SDW-S-1Y": {
      list: 595,
      price: 401,
      discount: 41,
      zoho_product_id: "2570562000261763082",
      discount_per_unit: 194,
      discount_pct: 33
    },
    "LIC-MX67-ENT-5YR": {
      list: 1287,
      price: 600,
      discount: 0.5338,
      zoho_product_id: "2570562000009487048",
      discount_per_unit: 687,
      discount_pct: 53
    },
    "LIC-MX80-SEC-1YR": {
      list: 2099,
      price: 1413,
      discount: 0.3268,
      zoho_product_id: "2570562000001277758",
      discount_per_unit: 686,
      discount_pct: 33
    },
    "LIC-MX100-ENT-1YR": {
      list: 2453,
      price: 1649,
      discount: 0.3278,
      zoho_product_id: "2570562000001097595",
      discount_per_unit: 804,
      discount_pct: 33
    },
    "LIC-MS42-1YR": {
      list: 236,
      price: 159,
      discount: 0.3263,
      zoho_product_id: "2570562000001259225",
      discount_per_unit: 77,
      discount_pct: 33
    },
    "LIC-MX80-SEC-5YR": {
      list: 7872,
      price: 5294,
      discount: 0.3275,
      zoho_product_id: "2570562000001277760",
      discount_per_unit: 2578,
      discount_pct: 33
    },
    "LIC-MS125-24-3Y": {
      list: 359,
      price: 152,
      discount: 0.5766,
      zoho_product_id: "2570562000019405054",
      discount_per_unit: 207,
      discount_pct: 58
    },
    "LIC-MS420-48-3YR": {
      list: 5845,
      price: 3931,
      discount: 0.3275,
      zoho_product_id: "2570562000001277626",
      discount_per_unit: 1914,
      discount_pct: 33
    },
    "LIC-MX100-SEC-3YR": {
      list: 11038,
      price: 7423,
      discount: 0.3275,
      zoho_product_id: "2570562000001097601",
      discount_per_unit: 3615,
      discount_pct: 33
    },
    "LIC-MS42P-1YR": {
      list: 236,
      price: 159,
      discount: 0.3263,
      zoho_product_id: "2570562000001259230",
      discount_per_unit: 77,
      discount_pct: 33
    },
    "LIC-MG21-ENT-1Y": {
      list: 236,
      price: 159,
      discount: 0.3263,
      zoho_product_id: "2570562000025231459",
      discount_per_unit: 77,
      discount_pct: 33
    },
    "LIC-VMXL-SASENT-1Y": {
      list: 4906,
      price: 3300,
      discount: 0.3274,
      zoho_product_id: "2570562000320743651",
      discount_per_unit: 1606,
      discount_pct: 33
    },
    "LIC-VMXL-SASENT-3Y": {
      list: 11040,
      price: 7424,
      discount: 0.3275,
      zoho_product_id: "2570562000320743652",
      discount_per_unit: 3616,
      discount_pct: 33
    },
    "LIC-VMXL-SASENT-5Y": {
      list: 18398,
      price: 12371,
      discount: 0.3276,
      zoho_product_id: "2570562000320743653",
      discount_per_unit: 6027,
      discount_pct: 33
    },
    "LIC-VMX-L-SEC-1Y": {
      list: 9812,
      price: 6599,
      discount: 0.3275,
      zoho_product_id: "2570562000320658338",
      discount_per_unit: 3213,
      discount_pct: 33
    },
    "LIC-MX95-SDW-3Y": {
      list: 15234,
      price: 10244,
      discount: 0.3276,
      zoho_product_id: "2570562000064739419",
      discount_per_unit: 4990,
      discount_pct: 33
    },
    "LIC-MX68W-ENT-5YR": {
      list: 1656,
      price: 771,
      discount: 0.5344,
      zoho_product_id: "2570562000010635060",
      discount_per_unit: 885,
      discount_pct: 53
    },
    "LIC-MX60-SEC-3YR": {
      list: 1181,
      price: 794,
      discount: 0.3277,
      zoho_product_id: "2570562000001277693",
      discount_per_unit: 387,
      discount_pct: 33
    },
    "LIC-MS220-48LP-5YR": {
      list: 1242,
      price: 836,
      discount: 0.3269,
      zoho_product_id: "2570562000001259297",
      discount_per_unit: 406,
      discount_pct: 33
    },
    "LIC-VMX-L-SEC-3Y": {
      list: 22077,
      price: 14846,
      discount: 0.3275,
      zoho_product_id: "2570562000307395172",
      discount_per_unit: 7231,
      discount_pct: 33
    },
    "LIC-VMX-L-SEC-5Y": {
      list: 36796,
      price: 24743,
      discount: 0.3276,
      zoho_product_id: "2570562000320658309",
      discount_per_unit: 12053,
      discount_pct: 33
    },
    "LIC-VMXM-SASENT-1Y": {
      list: 2453,
      price: 1649,
      discount: 0.3278,
      zoho_product_id: "2570562000320743654",
      discount_per_unit: 804,
      discount_pct: 33
    },
    "LIC-VMXM-SASENT-3Y": {
      list: 5518,
      price: 3711,
      discount: 0.3275,
      zoho_product_id: "2570562000320743655",
      discount_per_unit: 1807,
      discount_pct: 33
    },
    "LIC-VMXM-SASENT-5Y": {
      list: 9197,
      price: 6185,
      discount: 0.3275,
      zoho_product_id: "2570562000320743656",
      discount_per_unit: 3012,
      discount_pct: 33
    },
    "LIC-VMX-M-SEC-5Y": {
      list: 18394,
      price: 12369,
      discount: 0.3276,
      zoho_product_id: "2570562000291926204",
      discount_per_unit: 6025,
      discount_pct: 33
    },
    "LIC-VMXS-SASENT-1Y": {
      list: 491,
      price: 331,
      discount: 0.3259,
      zoho_product_id: "2570562000320743657",
      discount_per_unit: 160,
      discount_pct: 33
    },
    "LIC-VMXS-SASENT-3Y": {
      list: 1105,
      price: 744,
      discount: 0.3267,
      zoho_product_id: "2570562000320743658",
      discount_per_unit: 361,
      discount_pct: 33
    },
    "LIC-MG21-ENT-3Y": {
      list: 531,
      price: 357,
      discount: 0.3277,
      zoho_product_id: "2570562000025231455",
      discount_per_unit: 174,
      discount_pct: 33
    },
    "LIC-MX67W-SEC-3YR": {
      list: 1655,
      price: 866,
      discount: 0.4767,
      zoho_product_id: "2570562000009567277",
      discount_per_unit: 789,
      discount_pct: 48
    },
    "LIC-MS355-48X2-5YR": {
      list: 4967,
      price: 2428,
      discount: 0.5112,
      zoho_product_id: "2570562000012504178",
      discount_per_unit: 2539,
      discount_pct: 51
    },
    "LIC-C9300-24E-1Y": {
      list: 749,
      price: 453,
      discount: 0.3952,
      zoho_product_id: "2570562000199758027",
      discount_per_unit: 296,
      discount_pct: 40
    },
    "LIC-MV-CA180-1YR": {
      list: 1104,
      price: 743,
      discount: 0.327,
      zoho_product_id: "2570562000012349696",
      discount_per_unit: 361,
      discount_pct: 33
    },
    "LIC-MX75-SDW-1Y": {
      list: 2860,
      price: 1924,
      discount: 0.3273,
      zoho_product_id: "2570562000064739388",
      discount_per_unit: 936,
      discount_pct: 33
    },
    "LIC-MX68-ENT-3YR": {
      list: 829,
      price: 520,
      discount: 0.3727,
      zoho_product_id: "2570562000010523440",
      discount_per_unit: 309,
      discount_pct: 37
    },
    "LIC-MX67W-ENT-3YR": {
      list: 829,
      price: 434,
      discount: 0.4765,
      zoho_product_id: "2570562000010635045",
      discount_per_unit: 395,
      discount_pct: 48
    },
    "LIC-MS450-12-3YR": {
      list: 3294,
      price: 2216,
      discount: 0.3273,
      zoho_product_id: "2570562000017212213",
      discount_per_unit: 1078,
      discount_pct: 33
    },
    "LIC-MX95-SDW-1Y": {
      list: 6771,
      price: 4553,
      discount: 0.3276,
      zoho_product_id: "2570562000064739418",
      discount_per_unit: 2218,
      discount_pct: 33
    },
    "LIC-MX85-SDW-1Y": {
      list: 3950,
      price: 2656,
      discount: 0.3276,
      zoho_product_id: "2570562000064739403",
      discount_per_unit: 1294,
      discount_pct: 33
    },
    "LIC-MX100-SDW-5Y": {
      list: 25390,
      price: 17072,
      discount: 0.3276,
      zoho_product_id: "2570562000034650468",
      discount_per_unit: 8318,
      discount_pct: 33
    },
    "LIC-MX-SDW-L-1Y": {
      list: 2129,
      price: 1432,
      discount: 41,
      zoho_product_id: "2570562000261763051",
      discount_per_unit: 697,
      discount_pct: 33
    },
    "LIC-MX-SDW-XL-5Y": {
      list: 46830,
      price: 21801,
      discount: 59,
      zoho_product_id: "2570562000261763052",
      discount_per_unit: 25029,
      discount_pct: 53
    },
    "LIC-MX67-SDW-5Y": {
      list: 3639,
      price: 1694,
      discount: 0.5345,
      zoho_product_id: "2570562000034650499",
      discount_per_unit: 1945,
      discount_pct: 53
    },
    "LIC-MX450-SEC-3YR": {
      list: 44155,
      price: 29691,
      discount: 0.3276,
      zoho_product_id: "2570562000001097631",
      discount_per_unit: 14464,
      discount_pct: 33
    },
    "LIC-MX450-ENT-5YR": {
      list: 36796,
      price: 17130,
      discount: 0.5345,
      zoho_product_id: "2570562000001097627",
      discount_per_unit: 19666,
      discount_pct: 53
    },
    "LIC-MX250-SEC-3YR": {
      list: 22078,
      price: 14846,
      discount: 0.3276,
      zoho_product_id: "2570562000001097611",
      discount_per_unit: 7232,
      discount_pct: 33
    },
    "LIC-MX250-ENT-1YR": {
      list: 4906,
      price: 3300,
      discount: 0.3274,
      zoho_product_id: "2570562000001097605",
      discount_per_unit: 1606,
      discount_pct: 33
    },
    "LIC-MX250-ENT-3YR": {
      list: 11038,
      price: 7423,
      discount: 0.3275,
      zoho_product_id: "2570562000001097606",
      discount_per_unit: 3615,
      discount_pct: 33
    },
    "LIC-MX450-SEC-1YR": {
      list: 19624,
      price: 13197,
      discount: 0.3275,
      zoho_product_id: "2570562000001097630",
      discount_per_unit: 6427,
      discount_pct: 33
    },
    "LIC-MX250-SEC-1YR": {
      list: 9812,
      price: 6599,
      discount: 0.3275,
      zoho_product_id: "2570562000001097610",
      discount_per_unit: 3213,
      discount_pct: 33
    },
    "LIC-MX250-ENT-5YR": {
      list: 18398,
      price: 8566,
      discount: 0.5344,
      zoho_product_id: "2570562000001097607",
      discount_per_unit: 9832,
      discount_pct: 53
    },
    "LIC-MX450-SEC-5YR": {
      list: 73592,
      price: 34259,
      discount: 0.5345,
      zoho_product_id: "2570562000001097632",
      discount_per_unit: 39333,
      discount_pct: 53
    },
    "LIC-MX65W-SDW-1Y": {
      list: 1374,
      price: 924,
      discount: 0.3275,
      zoho_product_id: "2570562000034650493",
      discount_per_unit: 450,
      discount_pct: 33
    },
    "LIC-MX250-SEC-5YR": {
      list: 36796,
      price: 17130,
      discount: 0.5345,
      zoho_product_id: "2570562000001097612",
      discount_per_unit: 19666,
      discount_pct: 53
    },
    "LIC-MX-SDW-L-3Y": {
      list: 4792,
      price: 3223,
      discount: 42,
      zoho_product_id: "2570562000261763078",
      discount_per_unit: 1569,
      discount_pct: 33
    },
    "LIC-MX-SDW-XL-3Y": {
      list: 28098,
      price: 18894,
      discount: 41,
      zoho_product_id: "2570562000261763079",
      discount_per_unit: 9204,
      discount_pct: 33
    },
    "LIC-MX64W-SDW-5Y": {
      list: 4414,
      price: 2969,
      discount: 0.3274,
      zoho_product_id: "2570562000034650488",
      discount_per_unit: 1445,
      discount_pct: 33
    },
    "LIC-MS125-24P-1Y": {
      list: 260,
      price: 109,
      discount: 0.5808,
      zoho_product_id: "2570562000019405050",
      discount_per_unit: 151,
      discount_pct: 58
    },
    "LIC-MS210-24-5YR": {
      list: 753,
      price: 325,
      discount: 0.5684,
      zoho_product_id: "2570562000001647064",
      discount_per_unit: 428,
      discount_pct: 57
    },
    "LIC-MX68-SDW-5Y": {
      list: 4783,
      price: 2226,
      discount: 0.5346,
      zoho_product_id: "2570562000034650514",
      discount_per_unit: 2557,
      discount_pct: 53
    },
    "LIC-MX-SDW-M-3Y": {
      list: 3377,
      price: 2271,
      discount: 42,
      discount_per_unit: 1106,
      discount_pct: 33
    },
    "LIC-MS125-48FP-1Y": {
      list: 449,
      price: 189,
      discount: 0.5791,
      zoho_product_id: "2570562000019405051",
      discount_per_unit: 260,
      discount_pct: 58
    },
    "LIC-MS125-24-1Y": {
      list: 160,
      price: 68,
      discount: 0.575,
      zoho_product_id: "2570562000019405053",
      discount_per_unit: 92,
      discount_pct: 57
    },
    "LIC-MS130-48A-3Y": {
      list: 1345,
      price: 352,
      discount: 0.7383,
      zoho_product_id: "2570562000261763098",
      discount_per_unit: 993,
      discount_pct: 74
    },
    "LIC-MX67C-ENT-1YR": {
      list: 417,
      price: 218,
      discount: 0.4772,
      zoho_product_id: "2570562000010635048",
      discount_per_unit: 199,
      discount_pct: 48
    },
    "LIC-MX80-ENT-3YR": {
      list: 2362,
      price: 1589,
      discount: 0.3273,
      zoho_product_id: "2570562000001277754",
      discount_per_unit: 773,
      discount_pct: 33
    },
    "LIC-MS125-48LP-1Y": {
      list: 301,
      price: 126,
      discount: 0.5814,
      zoho_product_id: "2570562000019405061",
      discount_per_unit: 175,
      discount_pct: 58
    },
    "LIC-MV-CA30-5Y": {
      list: 1104,
      price: 743,
      discount: 0.327,
      zoho_product_id: "2570562000050395698",
      discount_per_unit: 361,
      discount_pct: 33
    },
    "LIC-MX95-ENT-3Y": {
      list: 5518,
      price: 3711,
      discount: 0.3275,
      zoho_product_id: "2570562000064739409",
      discount_per_unit: 1807,
      discount_pct: 33
    },
    "LIC-MX-SDW-XS-3Y": {
      list: 1300,
      price: 874,
      discount: 42,
      zoho_product_id: "2570562000261763068",
      discount_per_unit: 426,
      discount_pct: 33
    },
    "LIC-MX-SDW-XS-1Y": {
      list: 578,
      price: 389,
      discount: 41,
      zoho_product_id: "2570562000261763069",
      discount_per_unit: 189,
      discount_pct: 33
    },
    "LIC-MS120-48FP-5YR": {
      list: 1174,
      price: 493,
      discount: 0.5801,
      zoho_product_id: "2570562000003355063",
      discount_per_unit: 681,
      discount_pct: 58
    },
    "LIC-MS210-48LP-5YR": {
      list: 1441,
      price: 622,
      discount: 0.5684,
      zoho_product_id: "2570562000001647079",
      discount_per_unit: 819,
      discount_pct: 57
    },
    "LIC-MX-SDW-M-1Y": {
      list: 1501,
      price: 1010,
      discount: 41,
      zoho_product_id: "2570562000261763070",
      discount_per_unit: 491,
      discount_pct: 33
    },
    "LIC-MX250-SDW-5Y": {
      list: 63472,
      price: 29548,
      discount: 0.5345,
      zoho_product_id: "2570562000034650473",
      discount_per_unit: 33924,
      discount_pct: 53
    },
    "LIC-MS120-8-3YR": {
      list: 106,
      price: 45,
      discount: 0.5755,
      zoho_product_id: "2570562000001259236",
      discount_per_unit: 61,
      discount_pct: 58
    },
    "LIC-MS120-48-5YR": {
      list: 731,
      price: 307,
      discount: 0.58,
      zoho_product_id: "2570562000001259262",
      discount_per_unit: 424,
      discount_pct: 58
    },
    "LIC-MS150-48-5Y": {
      list: 1122,
      price: 484,
      discount: 0.5686,
      zoho_product_id: "2570562000288874512",
      discount_per_unit: 638,
      discount_pct: 57
    },
    "LIC-C9300-24E-5Y": {
      list: 2362,
      price: 1425,
      discount: 0.3967,
      zoho_product_id: "2570562000199758026",
      discount_per_unit: 937,
      discount_pct: 40
    },
    "LIC-MS390-24A-1Y": {
      list: 1583,
      price: 774,
      discount: 0.5111,
      zoho_product_id: "2570562000025231460",
      discount_per_unit: 809,
      discount_pct: 51
    },
    "LIC-MS355-48X-3YR": {
      list: 2711,
      price: 1325,
      discount: 0.5113,
      zoho_product_id: "2570562000012504174",
      discount_per_unit: 1386,
      discount_pct: 51
    },
    "LIC-MX67C-SDW-3Y": {
      list: 3202,
      price: 1675,
      discount: 0.4769,
      zoho_product_id: "2570562000034650503",
      discount_per_unit: 1527,
      discount_pct: 48
    },
    "LIC-VMX-M-SEC-1Y": {
      list: 4905,
      price: 3299,
      discount: 0.3274,
      zoho_product_id: "2570562000291926140",
      discount_per_unit: 1606,
      discount_pct: 33
    },
    "LIC-MX64-SEC-3YR": {
      list: 1326,
      price: 831,
      discount: 0.3733,
      zoho_product_id: "2570562000001097525",
      discount_per_unit: 495,
      discount_pct: 37
    },
    "LIC-MX64-SEC-5YR": {
      list: 2209,
      price: 1384,
      discount: 0.3735,
      zoho_product_id: "2570562000001097526",
      discount_per_unit: 825,
      discount_pct: 37
    },
    "LIC-MX64W-ENT-1YR": {
      list: 319,
      price: 200,
      discount: 0.373,
      zoho_product_id: "2570562000001097529",
      discount_per_unit: 119,
      discount_pct: 37
    },
    "LIC-MX105-ENT-3Y": {
      list: 8280,
      price: 5568,
      discount: 0.3275,
      zoho_product_id: "2570562000064739424",
      discount_per_unit: 2712,
      discount_pct: 33
    },
    "LIC-MX75-SDW-5Y": {
      list: 10778,
      price: 5017,
      discount: 0.5345,
      zoho_product_id: "2570562000064739390",
      discount_per_unit: 5761,
      discount_pct: 53
    },
    "LIC-MX85-SDW-5Y": {
      list: 14812,
      price: 6895,
      discount: 0.5345,
      zoho_product_id: "2570562000064739405",
      discount_per_unit: 7917,
      discount_pct: 53
    },
    "LIC-MX64W-ENT-3YR": {
      list: 719,
      price: 451,
      discount: 0.3727,
      zoho_product_id: "2570562000001097530",
      discount_per_unit: 268,
      discount_pct: 37
    },
    "LIC-MX64-SEC-1YR": {
      list: 589,
      price: 370,
      discount: 0.3718,
      zoho_product_id: "2570562000001097524",
      discount_per_unit: 219,
      discount_pct: 37
    },
    "LIC-MX64W-SEC-3YR": {
      list: 1436,
      price: 900,
      discount: 0.3733,
      zoho_product_id: "2570562000001097535",
      discount_per_unit: 536,
      discount_pct: 37
    },
    "LIC-MX64W-SEC-1YR": {
      list: 638,
      price: 400,
      discount: 0.373,
      zoho_product_id: "2570562000001097534",
      discount_per_unit: 238,
      discount_pct: 37
    },
    "LIC-MX64-ENT-3YR": {
      list: 661,
      price: 415,
      discount: 0.3722,
      zoho_product_id: "2570562000001097520",
      discount_per_unit: 246,
      discount_pct: 37
    },
    "LIC-MX64-ENT-5YR": {
      list: 1103,
      price: 692,
      discount: 0.3726,
      zoho_product_id: "2570562000001097521",
      discount_per_unit: 411,
      discount_pct: 37
    },
    "LIC-C9300-48A-3Y": {
      list: 6980,
      price: 4213,
      discount: 0.3964,
      zoho_product_id: "2570562000199758013",
      discount_per_unit: 2767,
      discount_pct: 40
    },
    "LIC-C9300-48E-3Y": {
      list: 2594,
      price: 1566,
      discount: 0.3963,
      zoho_product_id: "2570562000199758014",
      discount_per_unit: 1028,
      discount_pct: 40
    },
    "LIC-C9300-24A-3Y": {
      list: 3849,
      price: 2323,
      discount: 0.3965,
      zoho_product_id: "2570562000199758015",
      discount_per_unit: 1526,
      discount_pct: 40
    },
    "LIC-C9300-24E-3Y": {
      list: 1412,
      price: 853,
      discount: 0.3959,
      zoho_product_id: "2570562000199758016",
      discount_per_unit: 559,
      discount_pct: 40
    },
    "LIC-MS210-48-1YR": {
      list: 307,
      price: 133,
      discount: 0.5668,
      zoho_product_id: "2570562000001647072",
      discount_per_unit: 174,
      discount_pct: 57
    },
    "LIC-MX64-ENT-1YR": {
      list: 294,
      price: 185,
      discount: 0.3707,
      zoho_product_id: "2570562000001097519",
      discount_per_unit: 109,
      discount_pct: 37
    },
    "LIC-MX64W-ENT-5YR": {
      list: 1197,
      price: 751,
      discount: 0.3726,
      zoho_product_id: "2570562000001097531",
      discount_per_unit: 446,
      discount_pct: 37
    },
    "LIC-MX64W-SEC-5YR": {
      list: 2393,
      price: 1500,
      discount: 0.3732,
      zoho_product_id: "2570562000001097536",
      discount_per_unit: 893,
      discount_pct: 37
    },
    "LIC-MX95-SEC-5Y": {
      list: 18398,
      price: 8566,
      discount: 0.5344,
      zoho_product_id: "2570562000064739415",
      discount_per_unit: 9832,
      discount_pct: 53
    },
    "LIC-MX105-SEC-5Y": {
      list: 27595,
      price: 12847,
      discount: 0.5344,
      zoho_product_id: "2570562000064739430",
      discount_per_unit: 14748,
      discount_pct: 53
    },
    "LIC-MS210-24-1YR": {
      list: 201,
      price: 87,
      discount: 0.5672,
      zoho_product_id: "2570562000001647062",
      discount_per_unit: 114,
      discount_pct: 57
    },
    "LIC-SME-1YR": {
      list: 40,
      price: 28,
      discount: 0.3,
      zoho_product_id: "2570562000001277653",
      discount_per_unit: 12,
      discount_pct: 30,
      zoho_active: false,
      replaced_by: "LIC-MI-EMSC-D-1YMC-A-1YR"
    },
    "LIC-SME-3YR": {
      list: 80,
      price: 54,
      discount: 0.325,
      zoho_product_id: "2570562000001277654",
      discount_per_unit: 26,
      discount_pct: 32,
      zoho_active: false,
      replaced_by: "LIC-MI-EMSC-D-1YMC-A-3YR"
    },
    "LIC-SME-5YR": {
      list: 120,
      price: 82,
      discount: 0.3167,
      zoho_product_id: "2570562000001277655",
      zoho_active: false,
      discount_per_unit: 38,
      discount_pct: 32,
      replaced_by: "LIC-MI-EMSC-D-1YMC-A-5YR"
    },
    "LIC-MS210-24P-1YR": {
      list: 248,
      price: 107,
      discount: 0.5685,
      zoho_product_id: "2570562000001647067",
      discount_per_unit: 141,
      discount_pct: 57
    },
    "LIC-MX68-SEC-1YR": {
      list: 736,
      price: 385,
      discount: 0.4769,
      zoho_product_id: "2570562000010635056",
      discount_per_unit: 351,
      discount_pct: 48
    },
    "LIC-MX67W-SEC-1YR": {
      list: 736,
      price: 385,
      discount: 0.4769,
      zoho_product_id: "2570562000010635047",
      discount_per_unit: 351,
      discount_pct: 48
    },
    "LIC-MS210-48LP-1YR": {
      list: 384,
      price: 167,
      discount: 0.5651,
      zoho_product_id: "2570562000001647077",
      discount_per_unit: 217,
      discount_pct: 57
    },
    "LIC-MX75-ENT-1Y": {
      list: 833,
      price: 522,
      discount: 0.3733,
      zoho_product_id: "2570562000064739378",
      discount_per_unit: 311,
      discount_pct: 37
    },
    "LIC-MX68W-SDW-3Y": {
      list: 3313,
      price: 1733,
      discount: 0.4769,
      zoho_product_id: "2570562000034650523",
      discount_per_unit: 1580,
      discount_pct: 48
    },
    "LIC-MG41-ENT-3Y": {
      list: 1064,
      price: 716,
      discount: 0.3271,
      zoho_product_id: "2570562000064739439",
      discount_per_unit: 348,
      discount_pct: 33
    },
    "LIC-Z3-ENT-1YR": {
      list: 148,
      price: 90,
      discount: 0.3919,
      zoho_product_id: "2570562000001277666",
      discount_per_unit: 58,
      discount_pct: 39
    },
    "LIC-Z3-ENT-5YR": {
      list: 553,
      price: 334,
      discount: 0.396,
      zoho_product_id: "2570562000001277668",
      discount_per_unit: 219,
      discount_pct: 40
    },
    "LIC-Z3-ENT-3YR": {
      list: 332,
      price: 201,
      discount: 0.3946,
      zoho_product_id: "2570562000001277667",
      discount_per_unit: 131,
      discount_pct: 39
    },
    "LIC-MX450-SDW-5Y": {
      list: 126942,
      price: 59094,
      discount: 0.5345,
      zoho_product_id: "2570562000034650478",
      discount_per_unit: 67848,
      discount_pct: 53
    },
    "LIC-MR-ADV-5Y": {
      list: 1254,
      price: 844,
      discount: 0.327,
      zoho_product_id: "2570562000022573149",
      discount_per_unit: 410,
      discount_pct: 33
    },
    "LIC-MX95-SEC-1Y": {
      list: 4906,
      price: 3300,
      discount: 0.3274,
      zoho_product_id: "2570562000064739413",
      discount_per_unit: 1606,
      discount_pct: 33
    },
    "LIC-MX105-SEC-1Y": {
      list: 7359,
      price: 4948,
      discount: 0.3276,
      zoho_product_id: "2570562000064739428",
      discount_per_unit: 2411,
      discount_pct: 33
    },
    "LIC-MX85-SEC-3Y": {
      list: 5518,
      price: 3711,
      discount: 0.3275,
      zoho_product_id: "2570562000064739399",
      discount_per_unit: 1807,
      discount_pct: 33
    },
    "LIC-MX68-SDW-1Y": {
      list: 1275,
      price: 859,
      discount: 0.3263,
      zoho_product_id: "2570562000034650512",
      discount_per_unit: 416,
      discount_pct: 33
    },
    "LIC-MX84-SDW-1Y": {
      list: 3385,
      price: 2277,
      discount: 0.3273,
      zoho_product_id: "2570562000034650527",
      discount_per_unit: 1108,
      discount_pct: 33
    },
    "LIC-MX250-SDW-1Y": {
      list: 16926,
      price: 11382,
      discount: 0.3275,
      zoho_product_id: "2570562000034650471",
      discount_per_unit: 5544,
      discount_pct: 33
    },
    "LIC-MX450-SDW-1Y": {
      list: 33851,
      price: 22762,
      discount: 0.3276,
      zoho_product_id: "2570562000034650476",
      discount_per_unit: 11089,
      discount_pct: 33
    },
    "LIC-MV-CA365-5Y": {
      list: 11038,
      price: 7423,
      discount: 0.3275,
      zoho_product_id: "2570562000099103283",
      discount_per_unit: 3615,
      discount_pct: 33
    },
    "LIC-MS355-24X-5YR": {
      list: 2751,
      price: 1344,
      discount: 0.5115,
      zoho_product_id: "2570562000012504169",
      discount_per_unit: 1407,
      discount_pct: 51
    },
    "LIC-MS355-48X-5YR": {
      list: 4520,
      price: 2208,
      discount: 0.5115,
      zoho_product_id: "2570562000014316950",
      discount_per_unit: 2312,
      discount_pct: 51
    },
    "LIC-MX75-SDW-3Y": {
      list: 6467,
      price: 4348,
      discount: 0.3277,
      zoho_product_id: "2570562000064739389",
      discount_per_unit: 2119,
      discount_pct: 33
    },
    "LIC-MX85-SDW-3Y": {
      list: 8887,
      price: 5976,
      discount: 0.3276,
      zoho_product_id: "2570562000064739404",
      discount_per_unit: 2911,
      discount_pct: 33
    },
    "LIC-MX105-SDW-3Y": {
      list: 21581,
      price: 14513,
      discount: 0.3275,
      zoho_product_id: "2570562000064739434",
      discount_per_unit: 7068,
      discount_pct: 33
    },
    "LIC-MX68CW-SEC-3YR": {
      list: 2319,
      price: 1214,
      discount: 0.4765,
      zoho_product_id: "2570562000010635067",
      discount_per_unit: 1105,
      discount_pct: 48
    },
    "LIC-MX250-SDW-3Y": {
      list: 38084,
      price: 25609,
      discount: 0.3276,
      zoho_product_id: "2570562000034650472",
      discount_per_unit: 12475,
      discount_pct: 33
    },
    "LIC-MX64W-SDW-3Y": {
      list: 2648,
      price: 1782,
      discount: 0.327,
      zoho_product_id: "2570562000034650487",
      discount_per_unit: 866,
      discount_pct: 33
    },
    "LIC-MX68-SDW-3Y": {
      list: 2870,
      price: 1930,
      discount: 0.3275,
      zoho_product_id: "2570562000034650513",
      discount_per_unit: 940,
      discount_pct: 33
    },
    "LIC-MX64-SDW-3Y": {
      list: 2538,
      price: 1707,
      discount: 0.3274,
      zoho_product_id: "2570562000034650482",
      discount_per_unit: 831,
      discount_pct: 33
    },
    "LIC-MX85-ENT-5Y": {
      list: 4599,
      price: 2141,
      discount: 0.5345,
      zoho_product_id: "2570562000064739395",
      discount_per_unit: 2458,
      discount_pct: 53
    },
    "LIC-MX75-SEC-3Y": {
      list: 3757,
      price: 1749,
      discount: 0.5345,
      zoho_product_id: "2570562000064739384",
      discount_per_unit: 2008,
      discount_pct: 53
    },
    "LIC-MX67-SEC-5YR": {
      list: 2574,
      price: 1199,
      discount: 0.5342,
      zoho_product_id: "2570562000010635043",
      discount_per_unit: 1375,
      discount_pct: 53
    },
    "LIC-MX100-SEC-5YR": {
      list: 18398,
      price: 12371,
      discount: 0.3276,
      zoho_product_id: "2570562000001097602",
      discount_per_unit: 6027,
      discount_pct: 33
    },
    "LIC-MS125-48FP-3Y": {
      list: 1010,
      price: 424,
      discount: 0.5802,
      zoho_product_id: "2570562000019405047",
      discount_per_unit: 586,
      discount_pct: 58
    },
    "LIC-C9300-24A-1Y": {
      list: 1986,
      price: 1199,
      discount: 0.3963,
      zoho_product_id: "2570562000200914217",
      discount_per_unit: 787,
      discount_pct: 40
    },
    "LIC-MX75-SEC-5Y": {
      list: 6262,
      price: 2916,
      discount: 0.5343,
      zoho_product_id: "2570562000064739385",
      discount_per_unit: 3346,
      discount_pct: 53
    },
    "LIC-Z4-SEC-3Y": {
      list: 953,
      price: 499,
      discount: 0.4764,
      zoho_product_id: "2570562000175925312",
      discount_per_unit: 454,
      discount_pct: 48
    },
    "LIC-MX450-SDW-3Y": {
      list: 76165,
      price: 51215,
      discount: 0.3276,
      zoho_product_id: "2570562000034650477",
      discount_per_unit: 24950,
      discount_pct: 33
    },
    "LIC-MX-SDW-XS-5Y": {
      list: 2166,
      price: 1457,
      discount: 42,
      zoho_product_id: "2570562000261763071",
      discount_per_unit: 709,
      discount_pct: 33
    },
    "LIC-MX-SDW-M-5Y": {
      list: 5628,
      price: 2620,
      discount: 60,
      zoho_product_id: "2570562000261763072",
      discount_per_unit: 3008,
      discount_pct: 53
    },
    "LIC-MX-SDW-S-5Y": {
      list: 2233,
      price: 1040,
      discount: 60,
      zoho_product_id: "2570562000261763073",
      discount_per_unit: 1193,
      discount_pct: 53
    },
    "LIC-MS125-24P-3Y": {
      list: 585,
      price: 246,
      discount: 0.5795,
      zoho_product_id: "2570562000019405048",
      discount_per_unit: 339,
      discount_pct: 58
    },
    "LIC-MX65-SDW-1Y": {
      list: 1177,
      price: 792,
      discount: 0.3271,
      zoho_product_id: "2570562000034650490",
      discount_per_unit: 385,
      discount_pct: 33
    },
    "LIC-MS125-48-3Y": {
      list: 520,
      price: 218,
      discount: 0.5808,
      zoho_product_id: "2570562000019405055",
      discount_per_unit: 302,
      discount_pct: 58
    },
    "LIC-MX67C-SEC-5YR": {
      list: 3127,
      price: 1456,
      discount: 0.5344,
      zoho_product_id: "2570562000010635053",
      discount_per_unit: 1671,
      discount_pct: 53
    },
    "LIC-MS130-CMPTA-3Y": {
      list: 302,
      price: 79,
      discount: 0.7384,
      zoho_product_id: "2570562000261763099",
      discount_per_unit: 223,
      discount_pct: 74
    },
    "LIC-MX67W-SDW-1Y": {
      list: 1024,
      price: 536,
      discount: 0.4766,
      zoho_product_id: "2570562000034650507",
      discount_per_unit: 488,
      discount_pct: 48
    },
    "LIC-MS125-48-5Y": {
      list: 866,
      price: 364,
      discount: 0.5797,
      zoho_product_id: "2570562000019405060",
      discount_per_unit: 502,
      discount_pct: 58
    },
    "LIC-MS130-CMPT-5Y": {
      list: 250,
      price: 131,
      discount: 0.476,
      zoho_product_id: "2570562000182445399",
      discount_per_unit: 119,
      discount_pct: 48
    },
    "LIC-MR-UPGR-5Y": {
      list: 753,
      price: 507,
      discount: 0.3267,
      zoho_product_id: "2570562000022573146",
      discount_per_unit: 246,
      discount_pct: 33
    },
    "LIC-ENT-3YR": {
      list: 452,
      price: 263,
      discount: 0.4181,
      zoho_product_id: "2570562000001098895",
      discount_per_unit: 189,
      discount_pct: 42
    },
    "LIC-MX67C-SEC-3YR": {
      list: 1877,
      price: 982,
      discount: 0.4768,
      zoho_product_id: "2570562000010635052",
      discount_per_unit: 895,
      discount_pct: 48
    },
    "LIC-MV-CA30-3Y": {
      list: 662,
      price: 446,
      discount: 0.3263,
      zoho_product_id: "2570562000064122022",
      discount_per_unit: 216,
      discount_pct: 33
    },
    "LIC-MX68W-ENT-3YR": {
      list: 993,
      price: 521,
      discount: 0.4753,
      zoho_product_id: "2570562000010635059",
      discount_per_unit: 472,
      discount_pct: 48
    },
    "LIC-MX68W-SEC-1YR": {
      list: 883,
      price: 462,
      discount: 0.4768,
      zoho_product_id: "2570562000010635061",
      discount_per_unit: 421,
      discount_pct: 48
    },
    "LIC-MR-ADV-3Y": {
      list: 753,
      price: 507,
      discount: 0.3267,
      zoho_product_id: "2570562000022573145",
      discount_per_unit: 246,
      discount_pct: 33
    },
    "LIC-MX67-ENT-3YR": {
      list: 773,
      price: 485,
      discount: 0.3726,
      zoho_product_id: "2570562000009436996",
      discount_per_unit: 288,
      discount_pct: 37
    },
    "LIC-MX105-SDW-5Y": {
      list: 35968,
      price: 16745,
      discount: 0.5344,
      zoho_product_id: "2570562000064739435",
      discount_per_unit: 19223,
      discount_pct: 53
    },
    "LIC-ENT-5YR": {
      list: 753,
      price: 438,
      discount: 0.4183,
      zoho_product_id: "2570562000001098896",
      discount_per_unit: 315,
      discount_pct: 42
    },
    "LIC-ENT-1YR": {
      list: 201,
      price: 117,
      discount: 0.4179,
      zoho_product_id: "2570562000001098894",
      discount_per_unit: 84,
      discount_pct: 42
    },
    "LIC-MX85-SEC-5Y": {
      list: 9197,
      price: 4282,
      discount: 0.5344,
      zoho_product_id: "2570562000064739400",
      discount_per_unit: 4915,
      discount_pct: 53
    },
    "LIC-MX67-SDW-1Y": {
      list: 970,
      price: 653,
      discount: 0.3268,
      zoho_product_id: "2570562000034650497",
      discount_per_unit: 317,
      discount_pct: 33
    },
    "LIC-MX-SDW-L-5Y": {
      list: 7986,
      price: 3718,
      discount: 60,
      zoho_product_id: "2570562000261763076",
      discount_per_unit: 4268,
      discount_pct: 53
    },
    "LIC-MX400-ENT-5YR": {
      list: 29436,
      price: 19793,
      discount: 0.3276,
      zoho_product_id: "2570562000001097617",
      discount_per_unit: 9643,
      discount_pct: 33
    },
    "LIC-VMX-S-ENT-1Y": {
      list: 491,
      price: 331,
      discount: 0.3259,
      zoho_product_id: "2570562000049126061",
      discount_per_unit: 160,
      discount_pct: 33
    },
    "LIC-VMX-S-ENT-3Y": {
      list: 1104,
      price: 743,
      discount: 0.327,
      zoho_product_id: "2570562000049126058",
      discount_per_unit: 361,
      discount_pct: 33
    },
    "LIC-VMX-S-ENT-5Y": {
      list: 1840,
      price: 1238,
      discount: 0.3272,
      zoho_product_id: "2570562000049126062",
      discount_per_unit: 602,
      discount_pct: 33
    },
    "LIC-VMX-M-ENT-1Y": {
      list: 2453,
      price: 1649,
      discount: 0.3278,
      zoho_product_id: "2570562000049126059",
      discount_per_unit: 804,
      discount_pct: 33
    },
    "LIC-VMX-M-ENT-3Y": {
      list: 5518,
      price: 3711,
      discount: 0.3275,
      zoho_product_id: "2570562000049126056",
      discount_per_unit: 1807,
      discount_pct: 33
    },
    "LIC-VMX-M-ENT-5Y": {
      list: 9197,
      price: 6185,
      discount: 0.3275,
      zoho_product_id: "2570562000049126055",
      discount_per_unit: 3012,
      discount_pct: 33
    },
    "LIC-MS220-24P-5YR": {
      list: 707,
      price: 476,
      discount: 0.3267,
      zoho_product_id: "2570562000001259287",
      discount_per_unit: 231,
      discount_pct: 33
    },
    "LIC-MS420-24-5YR": {
      list: 5314,
      price: 3574,
      discount: 0.3274,
      zoho_product_id: "2570562000001277622",
      discount_per_unit: 1740,
      discount_pct: 33
    },
    "LIC-MS320-48-1YR": {
      list: 437,
      price: 294,
      discount: 0.3272,
      zoho_product_id: "2570562000001259365",
      discount_per_unit: 143,
      discount_pct: 33
    },
    "LIC-VMX-L-ENT-1Y": {
      list: 4906,
      price: 3300,
      discount: 0.3274,
      zoho_product_id: "2570562000049126060",
      discount_per_unit: 1606,
      discount_pct: 33
    },
    "LIC-VMX-L-ENT-3Y": {
      list: 11038,
      price: 7423,
      discount: 0.3275,
      zoho_product_id: "2570562000049126057",
      discount_per_unit: 3615,
      discount_pct: 33
    },
    "LIC-VMX-L-ENT-5Y": {
      list: 18398,
      price: 12371,
      discount: 0.3276,
      zoho_product_id: "2570562000049126063",
      discount_per_unit: 6027,
      discount_pct: 33
    },
    "LIC-MX95-SEC-3Y": {
      list: 11038,
      price: 7423,
      discount: 0.3275,
      zoho_product_id: "2570562000064739414",
      discount_per_unit: 3615,
      discount_pct: 33
    },
    "LIC-MX105-SEC-3Y": {
      list: 16557,
      price: 11133,
      discount: 0.3276,
      zoho_product_id: "2570562000064739429",
      discount_per_unit: 5424,
      discount_pct: 33
    },
    "LIC-MS350-24X-3YR": {
      list: 1255,
      price: 585,
      discount: 0.5339,
      zoho_product_id: "2570562000001094209",
      discount_per_unit: 670,
      discount_pct: 53
    },
    "LIC-MX70-SEC-5YR": {
      list: 3e3,
      price: 1980,
      discount: 0.34,
      zoho_product_id: "2570562000001277752",
      discount_per_unit: 1020,
      discount_pct: 34
    },
    "LIC-MS420-24-1YR": {
      list: 1417,
      price: 953,
      discount: 0.3275,
      zoho_product_id: "2570562000001277620",
      discount_per_unit: 464,
      discount_pct: 33
    },
    "LIC-MS220-8P-5YR": {
      list: 309,
      price: 187,
      discount: 0.3948,
      zoho_product_id: "2570562000003355072",
      discount_per_unit: 122,
      discount_pct: 39
    },
    "LIC-VMX-S-SEC-3Y": {
      list: 2208,
      price: 1485,
      discount: 0.3274,
      zoho_product_id: "2570562000315687807",
      discount_per_unit: 723,
      discount_pct: 33
    },
    "LIC-VMX-M-SEC-3Y": {
      list: 11036,
      price: 7422,
      discount: 0.3275,
      zoho_product_id: "2570562000291926172",
      discount_per_unit: 3614,
      discount_pct: 33
    },
    "LIC-MS420-24-3YR": {
      list: 3188,
      price: 2145,
      discount: 0.3272,
      zoho_product_id: "2570562000001277621",
      discount_per_unit: 1043,
      discount_pct: 33
    },
    "LIC-VMX-S-SEC-1Y": {
      list: 981,
      price: 661,
      discount: 0.3262,
      zoho_product_id: "2570562000299359745",
      discount_per_unit: 320,
      discount_pct: 33
    },
    "LIC-MX67W-ENT-1YR": {
      list: 368,
      price: 193,
      discount: 0.4755,
      zoho_product_id: "2570562000010635044",
      discount_per_unit: 175,
      discount_pct: 48
    },
    "LIC-MX68CW-ENT-5YR": {
      list: 1931,
      price: 899,
      discount: 0.5344,
      zoho_product_id: "2570562000010635065",
      discount_per_unit: 1032,
      discount_pct: 53
    },
    "LIC-MX67-SEC-3YR": {
      list: 1544,
      price: 826,
      discount: 0.465,
      zoho_product_id: "2570562000009856531",
      discount_per_unit: 718,
      discount_pct: 47
    },
    "LIC-MS220-24P-3YR": {
      list: 424,
      price: 286,
      discount: 0.3255,
      zoho_product_id: "2570562000001259286",
      discount_per_unit: 138,
      discount_pct: 33
    },
    "LIC-Z4-SEC-1Y": {
      list: 424,
      price: 222,
      discount: 0.4764,
      zoho_product_id: "2570562000175925311",
      discount_per_unit: 202,
      discount_pct: 48
    },
    "LIC-MX68CW-SEC-5YR": {
      list: 3864,
      price: 1800,
      discount: 0.5342,
      zoho_product_id: "2570562000010635068",
      discount_per_unit: 2064,
      discount_pct: 53
    },
    "LIC-MX68W-SEC-5YR": {
      list: 3312,
      price: 1543,
      discount: 0.5341,
      zoho_product_id: "2570562000010635062",
      discount_per_unit: 1769,
      discount_pct: 53
    },
    "LIC-MS355-24X2-3YR": {
      list: 2242,
      price: 1095,
      discount: 0.5116,
      zoho_product_id: "2570562000012504171",
      discount_per_unit: 1147,
      discount_pct: 51
    },
    "LIC-VMX-XL-ENT-5Y": {
      list: 25759,
      price: 17321,
      discount: 42,
      zoho_product_id: "2570562000261763095",
      discount_per_unit: 8438,
      discount_pct: 33
    },
    "LIC-VMX-XL-ENT-3Y": {
      list: 15456,
      price: 10393,
      discount: 42,
      zoho_product_id: "2570562000261763096",
      discount_per_unit: 5063,
      discount_pct: 33
    },
    "LIC-MX600-ENT-1YR": {
      list: 15699,
      price: 10556,
      discount: 0.3276,
      zoho_product_id: "2570562000001097635",
      discount_per_unit: 5143,
      discount_pct: 33
    },
    "LIC-MS355-24X2-5YR": {
      list: 3737,
      price: 1826,
      discount: 0.5114,
      zoho_product_id: "2570562000012504172",
      discount_per_unit: 1911,
      discount_pct: 51
    },
    "LIC-MS355-24X-3YR": {
      list: 1651,
      price: 807,
      discount: 0.5112,
      zoho_product_id: "2570562000012504168",
      discount_per_unit: 844,
      discount_pct: 51
    },
    "LIC-MS355-48X2-3YR": {
      list: 2980,
      price: 1456,
      discount: 0.5114,
      zoho_product_id: "2570562000012504177",
      discount_per_unit: 1524,
      discount_pct: 51
    },
    "LIC-MV-CA180-3YR": {
      list: 3312,
      price: 2228,
      discount: 0.3273,
      zoho_product_id: "2570562000012504183",
      discount_per_unit: 1084,
      discount_pct: 33
    },
    "LIC-MV-CA180-5YR": {
      list: 5519,
      price: 3711,
      discount: 0.3276,
      zoho_product_id: "2570562000012504184",
      discount_per_unit: 1808,
      discount_pct: 33
    },
    "LIC-MV-CA90-3YR": {
      list: 1656,
      price: 1114,
      discount: 0.3273,
      zoho_product_id: "2570562000012504181",
      discount_per_unit: 542,
      discount_pct: 33
    },
    "LIC-MS320-24-5YR": {
      list: 1107,
      price: 745,
      discount: 0.327,
      zoho_product_id: "2570562000001259357",
      discount_per_unit: 362,
      discount_pct: 33
    },
    "LIC-MS420-48-5YR": {
      list: 9743,
      price: 6552,
      discount: 0.3275,
      zoho_product_id: "2570562000001277627",
      discount_per_unit: 3191,
      discount_pct: 33
    },
    "LIC-MS425-16-1YR": {
      list: 974,
      price: 656,
      discount: 0.3265,
      zoho_product_id: "2570562000001097448",
      discount_per_unit: 318,
      discount_pct: 33
    },
    "LIC-MV-CA90-5YR": {
      list: 2760,
      price: 1856,
      discount: 0.3275,
      zoho_product_id: "2570562000012504182",
      discount_per_unit: 904,
      discount_pct: 33
    },
    "LIC-MV-SEN-1YR": {
      list: 148,
      price: 100,
      discount: 0.3243,
      zoho_product_id: "2570562000012504185",
      discount_per_unit: 48,
      discount_pct: 32
    },
    "LIC-MV-SEN-3YR": {
      list: 331,
      price: 223,
      discount: 0.3263,
      zoho_product_id: "2570562000012504186",
      discount_per_unit: 108,
      discount_pct: 33
    },
    "LIC-MS42P-3YR": {
      list: 531,
      price: 357,
      discount: 0.3277,
      zoho_product_id: "2570562000001259231",
      discount_per_unit: 174,
      discount_pct: 33
    },
    "LIC-MS220-8P-3YR": {
      list: 186,
      price: 113,
      discount: 0.3925,
      zoho_product_id: "2570562000003355071",
      discount_per_unit: 73,
      discount_pct: 39
    },
    "LIC-MX85-ENT-1Y": {
      list: 1226,
      price: 825,
      discount: 0.3271,
      zoho_product_id: "2570562000064739393",
      discount_per_unit: 401,
      discount_pct: 33
    },
    "LIC-MX95-SDW-5Y": {
      list: 25390,
      price: 11820,
      discount: 0.5345,
      zoho_product_id: "2570562000064739420",
      discount_per_unit: 13570,
      discount_pct: 53
    },
    "LIC-MX105-SDW-1Y": {
      list: 9591,
      price: 6449,
      discount: 0.3276,
      zoho_product_id: "2570562000064739433",
      discount_per_unit: 3142,
      discount_pct: 33
    },
    "LIC-MX68-SEC-5YR": {
      list: 2759,
      price: 1285,
      discount: 0.5343,
      zoho_product_id: "2570562000010635057",
      discount_per_unit: 1474,
      discount_pct: 53
    },
    "LIC-MX60-ENT-3YR": {
      list: 592,
      price: 399,
      discount: 0.326,
      zoho_product_id: "2570562000001277688",
      discount_per_unit: 193,
      discount_pct: 33
    },
    "LIC-MS125-48-1Y": {
      list: 231,
      price: 98,
      discount: 0.5758,
      zoho_product_id: "2570562000019405059",
      discount_per_unit: 133,
      discount_pct: 58
    },
    "LIC-MX90-SEC-5YR": {
      list: 15749,
      price: 10591,
      discount: 0.3275,
      zoho_product_id: "2570562000001277780",
      discount_per_unit: 5158,
      discount_pct: 33
    },
    "LIC-MX100-ENT-5YR": {
      list: 9197,
      price: 6185,
      discount: 0.3275,
      zoho_product_id: "2570562000001097597",
      discount_per_unit: 3012,
      discount_pct: 33
    },
    "LIC-MS220-8-3YR": {
      list: 147,
      price: 89,
      discount: 0.3946,
      zoho_product_id: "2570562000003355066",
      discount_per_unit: 58,
      discount_pct: 39
    },
    "LIC-MX90-SEC-3YR": {
      list: 9449,
      price: 6354,
      discount: 0.3275,
      zoho_product_id: "2570562000001277779",
      discount_per_unit: 3095,
      discount_pct: 33
    },
    "LIC-MX100-SEC-1YR": {
      list: 4906,
      price: 3300,
      discount: 0.3274,
      zoho_product_id: "2570562000001097600",
      discount_per_unit: 1606,
      discount_pct: 33
    },
    "LIC-MX68W-SDW-5Y": {
      list: 5520,
      price: 2570,
      discount: 0.5344,
      zoho_product_id: "2570562000034650524",
      discount_per_unit: 2950,
      discount_pct: 53
    },
    "LIC-MS220-48-5YR": {
      list: 929,
      price: 625,
      discount: 0.3272,
      zoho_product_id: "2570562000001259292",
      discount_per_unit: 304,
      discount_pct: 33
    },
    "LIC-MX90-ENT-3YR": {
      list: 4723,
      price: 3177,
      discount: 0.3273,
      zoho_product_id: "2570562000001277774",
      discount_per_unit: 1546,
      discount_pct: 33
    },
    "LIC-MX-SDW-XL-1Y": {
      list: 12488,
      price: 8397,
      discount: 42,
      zoho_product_id: "2570562000261763093",
      discount_per_unit: 4091,
      discount_pct: 33
    },
    "LIC-MX600-SEC-3YR": {
      list: 70646,
      price: 47505,
      discount: 0.3276,
      zoho_product_id: "2570562000001097641",
      discount_per_unit: 23141,
      discount_pct: 33
    },
    "LIC-MX400-ENT-3YR": {
      list: 17662,
      price: 11877,
      discount: 0.3275,
      zoho_product_id: "2570562000001097616",
      discount_per_unit: 5785,
      discount_pct: 33
    },
    "LIC-MX60W-SEC-1YR": {
      list: 577,
      price: 389,
      discount: 0.3258,
      zoho_product_id: "2570562000001277702",
      discount_per_unit: 188,
      discount_pct: 33
    },
    "LIC-MS390-48A-5Y": {
      list: 10962,
      price: 5355,
      discount: 0.5115,
      zoho_product_id: "2570562000025231464",
      discount_per_unit: 5607,
      discount_pct: 51
    },
    "LIC-MS450-12-5YR": {
      list: 5490,
      price: 3692,
      discount: 0.3275,
      zoho_product_id: "2570562000017212214",
      discount_per_unit: 1798,
      discount_pct: 33
    },
    "LIC-MS350-24X-5YR": {
      list: 2092,
      price: 975,
      discount: 0.5339,
      zoho_product_id: "2570562000001094210",
      discount_per_unit: 1117,
      discount_pct: 53
    },
    "LIC-MS120-48LP-3YR": {
      list: 585,
      price: 246,
      discount: 0.5795,
      zoho_product_id: "2570562000001259266",
      discount_per_unit: 339,
      discount_pct: 58
    },
    "LIC-MS150-24A-1Y": {
      list: 346,
      price: 149,
      discount: 0.5694,
      zoho_product_id: "2570562000290749272",
      discount_per_unit: 197,
      discount_pct: 57
    },
    "LIC-MS150-24A-3Y": {
      list: 778,
      price: 336,
      discount: 0.5681,
      zoho_product_id: "2570562000290749273",
      discount_per_unit: 442,
      discount_pct: 57
    },
    "LIC-MS150-24A-5Y": {
      list: 1296,
      price: 560,
      discount: 0.5679,
      zoho_product_id: "2570562000290749274",
      discount_per_unit: 736,
      discount_pct: 57
    },
    "LIC-MS425-32-1YR": {
      list: 1529,
      price: 1029,
      discount: 0.327,
      zoho_product_id: "2570562000001097453",
      discount_per_unit: 500,
      discount_pct: 33
    },
    "LIC-MS425-32-3YR": {
      list: 3441,
      price: 2314,
      discount: 0.3275,
      zoho_product_id: "2570562000001097454",
      discount_per_unit: 1127,
      discount_pct: 33
    },
    "LIC-MS150-48A-1Y": {
      list: 597,
      price: 257,
      discount: 0.5695,
      zoho_product_id: "2570562000290749279",
      discount_per_unit: 340,
      discount_pct: 57
    },
    "LIC-MS150-48A-3Y": {
      list: 1345,
      price: 580,
      discount: 0.5688,
      zoho_product_id: "2570562000290749280",
      discount_per_unit: 765,
      discount_pct: 57
    },
    "LIC-MS350-48FP-3YR": {
      list: 1913,
      price: 891,
      discount: 0.5342,
      zoho_product_id: "2570562000001094224",
      discount_per_unit: 1022,
      discount_pct: 53
    },
    "LIC-MS150-48-3Y": {
      list: 672,
      price: 291,
      discount: 0.567,
      zoho_product_id: "2570562000288888417",
      discount_per_unit: 381,
      discount_pct: 57
    },
    "LIC-VMXS-SASENT-5Y": {
      list: 1840,
      price: 1238,
      discount: 0.3272,
      zoho_product_id: "2570562000320743650",
      discount_per_unit: 602,
      discount_pct: 33
    },
    "LIC-VMX-S-SEC-5Y": {
      list: 3681,
      price: 2476,
      discount: 0.3274,
      zoho_product_id: "2570562000306558283",
      discount_per_unit: 1205,
      discount_pct: 33
    },
    "LIC-MS350-48LP-1YR": {
      list: 782,
      price: 364,
      discount: 0.5345,
      zoho_product_id: "2570562000001094218",
      discount_per_unit: 418,
      discount_pct: 53
    },
    "LIC-MX84-ENT-5YR": {
      list: 3681,
      price: 2476,
      discount: 0.3274,
      zoho_product_id: "2570562000001097577",
      discount_per_unit: 1205,
      discount_pct: 33
    },
    "LIC-MS350-48LP-5YR": {
      list: 2931,
      price: 1366,
      discount: 0.5339,
      zoho_product_id: "2570562000001094220",
      discount_per_unit: 1565,
      discount_pct: 53
    },
    "LIC-MS350-48LP-3YR": {
      list: 1759,
      price: 820,
      discount: 0.5338,
      zoho_product_id: "2570562000001094219",
      discount_per_unit: 939,
      discount_pct: 53
    },
    "LIC-MX84-SEC-1YR": {
      list: 1963,
      price: 1321,
      discount: 0.3271,
      zoho_product_id: "2570562000001097580",
      discount_per_unit: 642,
      discount_pct: 33
    },
    "LIC-MV-SEN-5YR": {
      list: 553,
      price: 372,
      discount: 0.3273,
      zoho_product_id: "2570562000012504187",
      discount_per_unit: 181,
      discount_pct: 33
    },
    "LIC-MS120-48FP-3YR": {
      list: 704,
      price: 297,
      discount: 0.5781,
      zoho_product_id: "2570562000003355062",
      discount_per_unit: 407,
      discount_pct: 58
    },
    "LIC-MS120-24P-3YR": {
      list: 386,
      price: 163,
      discount: 0.5777,
      zoho_product_id: "2570562000001259256",
      discount_per_unit: 223,
      discount_pct: 58
    },
    "LIC-VMX-XL-SEC-1Y": {
      list: 13738,
      price: 9238,
      discount: 42,
      discount_per_unit: 4500,
      discount_pct: 33
    },
    "LIC-VMX-XL-SEC-3Y": {
      list: 30912,
      price: 20786,
      discount: 42,
      discount_per_unit: 10126,
      discount_pct: 33
    },
    "LIC-VMX-XL-SEC-5Y": {
      list: 51518,
      price: 34642,
      discount: 42,
      discount_per_unit: 16876,
      discount_pct: 33
    },
    "LIC-MX84-SEC-3YR": {
      list: 4416,
      price: 2970,
      discount: 0.3274,
      zoho_product_id: "2570562000001097581",
      discount_per_unit: 1446,
      discount_pct: 33
    },
    "LIC-MS350-24P-5YR": {
      list: 1769,
      price: 824,
      discount: 0.5342,
      zoho_product_id: "2570562000001094205",
      discount_per_unit: 945,
      discount_pct: 53
    },
    "LIC-MS350-24P-3YR": {
      list: 1062,
      price: 494,
      discount: 0.5348,
      zoho_product_id: "2570562000001094204",
      discount_per_unit: 568,
      discount_pct: 53
    },
    "LIC-MS350-48FP-5YR": {
      list: 3187,
      price: 1484,
      discount: 0.5344,
      zoho_product_id: "2570562000001094225",
      discount_per_unit: 1703,
      discount_pct: 53
    },
    "LIC-MS350-24P-1YR": {
      list: 472,
      price: 221,
      discount: 0.5318,
      zoho_product_id: "2570562000001094203",
      discount_per_unit: 251,
      discount_pct: 53
    },
    "LIC-MS425-16-5YR": {
      list: 3654,
      price: 2457,
      discount: 0.3276,
      zoho_product_id: "2570562000001097450",
      discount_per_unit: 1197,
      discount_pct: 33
    },
    "LIC-MS350-48-3YR": {
      list: 1506,
      price: 702,
      discount: 0.5339,
      zoho_product_id: "2570562000001094214",
      discount_per_unit: 804,
      discount_pct: 53
    },
    "LIC-MS350-24-5YR": {
      list: 1535,
      price: 715,
      discount: 0.5342,
      zoho_product_id: "2570562000001094200",
      discount_per_unit: 820,
      discount_pct: 53
    },
    "LIC-MS350-48-1YR": {
      list: 669,
      price: 313,
      discount: 0.5321,
      zoho_product_id: "2570562000001094213",
      discount_per_unit: 356,
      discount_pct: 53
    },
    "LIC-MS350-48-5YR": {
      list: 2510,
      price: 1169,
      discount: 0.5343,
      zoho_product_id: "2570562000001094215",
      discount_per_unit: 1341,
      discount_pct: 53
    },
    "LIC-MS125-24P-5Y": {
      list: 974,
      price: 409,
      discount: 0.5801,
      zoho_product_id: "2570562000019405049",
      discount_per_unit: 565,
      discount_pct: 58
    },
    "LIC-MS125-48LP-3Y": {
      list: 677,
      price: 285,
      discount: 0.579,
      zoho_product_id: "2570562000019405056",
      discount_per_unit: 392,
      discount_pct: 58
    },
    "LIC-MS350-24X-1YR": {
      list: 558,
      price: 260,
      discount: 0.5341,
      zoho_product_id: "2570562000001094208",
      discount_per_unit: 298,
      discount_pct: 53
    },
    "LIC-MS425-16-3YR": {
      list: 2193,
      price: 1475,
      discount: 0.3274,
      zoho_product_id: "2570562000001097449",
      discount_per_unit: 718,
      discount_pct: 33
    },
    "LIC-MS425-32-5YR": {
      list: 5735,
      price: 3856,
      discount: 0.3276,
      zoho_product_id: "2570562000001097455",
      discount_per_unit: 1879,
      discount_pct: 33
    },
    "LIC-MG52-ENT-5Y": {
      list: 1694,
      price: 1139,
      discount: 0.3276,
      zoho_product_id: "2570562000239922052",
      discount_per_unit: 555,
      discount_pct: 33
    },
    "LIC-MS350-48FP-1YR": {
      list: 850,
      price: 397,
      discount: 0.5329,
      zoho_product_id: "2570562000001094223",
      discount_per_unit: 453,
      discount_pct: 53
    },
    "LIC-MS350-24-3YR": {
      list: 921,
      price: 430,
      discount: 0.5331,
      zoho_product_id: "2570562000001094199",
      discount_per_unit: 491,
      discount_pct: 53
    },
    "LIC-MX84-SEC-5YR": {
      list: 7361,
      price: 4949,
      discount: 0.3277,
      zoho_product_id: "2570562000001097582",
      discount_per_unit: 2412,
      discount_pct: 33
    },
    "LIC-MX67C-SEC-1YR": {
      list: 834,
      price: 437,
      discount: 0.476,
      zoho_product_id: "2570562000010635051",
      discount_per_unit: 397,
      discount_pct: 48
    },
    "LIC-MX84-ENT-1YR": {
      list: 981,
      price: 661,
      discount: 0.3262,
      zoho_product_id: "2570562000001097575",
      discount_per_unit: 320,
      discount_pct: 33
    },
    "LIC-MX84-ENT-3YR": {
      list: 2209,
      price: 1486,
      discount: 0.3273,
      zoho_product_id: "2570562000001097576",
      discount_per_unit: 723,
      discount_pct: 33
    },
    "LIC-Z4-ENT-1Y": {
      list: 201,
      price: 106,
      discount: 0.4726,
      zoho_product_id: "2570562000161357197",
      discount_per_unit: 95,
      discount_pct: 47
    },
    "LIC-MG52-ENT-1Y": {
      list: 452,
      price: 305,
      discount: 0.3252,
      zoho_product_id: "2570562000239922053",
      discount_per_unit: 147,
      discount_pct: 33
    },
    "LIC-MS210-48LP-3YR": {
      list: 865,
      price: 374,
      discount: 0.5676,
      zoho_product_id: "2570562000001647078",
      discount_per_unit: 491,
      discount_pct: 57
    },
    "LIC-MS350-24-1YR": {
      list: 409,
      price: 191,
      discount: 0.533,
      zoho_product_id: "2570562000001094198",
      discount_per_unit: 218,
      discount_pct: 53
    },
    "LIC-MX67-SEC-1YR": {
      list: 686,
      price: 368,
      discount: 0.4636,
      zoho_product_id: "2570562000010635042",
      discount_per_unit: 318,
      discount_pct: 46
    },
    "LIC-MV-CA7-5Y": {
      list: 331,
      price: 223,
      discount: 41,
      zoho_product_id: "2570562000248233886",
      discount_per_unit: 108,
      discount_pct: 33
    },
    "LIC-MS120-48FP-1YR": {
      list: 313,
      price: 132,
      discount: 0.5783,
      zoho_product_id: "2570562000003355061",
      discount_per_unit: 181,
      discount_pct: 58
    },
    "LIC-MX67C-SDW-1Y": {
      list: 1423,
      price: 745,
      discount: 0.4765,
      zoho_product_id: "2570562000034650502",
      discount_per_unit: 678,
      discount_pct: 48
    },
    "LIC-Z4-SEC-5Y": {
      list: 1589,
      price: 831,
      discount: 0.477,
      zoho_product_id: "2570562000175925313",
      discount_per_unit: 758,
      discount_pct: 48
    },
    "LIC-MX85-ENT-3Y": {
      list: 2760,
      price: 1856,
      discount: 0.3275,
      zoho_product_id: "2570562000064739394",
      discount_per_unit: 904,
      discount_pct: 33
    },
    "LIC-MX450-ENT-3YR": {
      list: 22078,
      price: 14846,
      discount: 0.3276,
      zoho_product_id: "2570562000001097626",
      discount_per_unit: 7232,
      discount_pct: 33
    },
    "LIC-Z4-ENT-3Y": {
      list: 452,
      price: 237,
      discount: 0.4757,
      zoho_product_id: "2570562000161073020",
      discount_per_unit: 215,
      discount_pct: 48
    },
    "LIC-C9200L-48A-1Y": {
      list: 3027,
      price: 2036,
      discount: 0.3274,
      zoho_product_id: "2570562000320743667",
      discount_per_unit: 991,
      discount_pct: 33
    },
    "LIC-C9200L-48A-5Y": {
      list: 9527,
      price: 6407,
      discount: 0.3275,
      zoho_product_id: "2570562000320743669",
      discount_per_unit: 3120,
      discount_pct: 33
    },
    "LIC-C9200L-48E-1Y": {
      list: 808,
      price: 544,
      discount: 0.3267,
      zoho_product_id: "2570562000320743670",
      discount_per_unit: 264,
      discount_pct: 33
    },
    "LIC-C9200L-48E-3Y": {
      list: 1556,
      price: 1047,
      discount: 0.3271,
      zoho_product_id: "2570562000320743671",
      discount_per_unit: 509,
      discount_pct: 33
    },
    "LIC-C9200L-48E-5Y": {
      list: 2593,
      price: 1744,
      discount: 0.3274,
      zoho_product_id: "2570562000320743672",
      discount_per_unit: 849,
      discount_pct: 33
    },
    "LIC-C9200L-24E-1Y": {
      list: 446,
      price: 301,
      discount: 0.3251,
      zoho_product_id: "2570562000320743673",
      discount_per_unit: 145,
      discount_pct: 33
    },
    "LIC-C9200L-24E-3Y": {
      list: 832,
      price: 560,
      discount: 0.3269,
      zoho_product_id: "2570562000320743674",
      discount_per_unit: 272,
      discount_pct: 33
    },
    "LIC-C9200L-24E-5Y": {
      list: 1447,
      price: 974,
      discount: 0.3269,
      zoho_product_id: "2570562000320743675",
      discount_per_unit: 473,
      discount_pct: 33
    },
    "LIC-C9200L-24A-1Y": {
      list: 1616,
      price: 1087,
      discount: 0.3274,
      zoho_product_id: "2570562000320743676",
      discount_per_unit: 529,
      discount_pct: 33
    },
    "LIC-C9200L-24A-3Y": {
      list: 3075,
      price: 2069,
      discount: 0.3272,
      zoho_product_id: "2570562000320743677",
      discount_per_unit: 1006,
      discount_pct: 33
    },
    "LIC-C9200L-24A-5Y": {
      list: 5126,
      price: 3447,
      discount: 0.3275,
      zoho_product_id: "2570562000320743678",
      discount_per_unit: 1679,
      discount_pct: 33
    },
    "LIC-DISPLAY-1Y": {
      list: 330,
      price: 223,
      discount: 0.3242,
      zoho_product_id: "2570562000180186037",
      discount_per_unit: 107,
      discount_pct: 32
    },
    "LIC-MS210-48FP-1YR": {
      list: 437,
      price: 189,
      discount: 0.5675,
      zoho_product_id: "2570562000001647082",
      discount_per_unit: 248,
      discount_pct: 57
    },
    "LIC-MS125-48FP-5Y": {
      list: 1682,
      price: 706,
      discount: 0.5803,
      zoho_product_id: "2570562000019405052",
      discount_per_unit: 976,
      discount_pct: 58
    },
    "LIC-MX67C-ENT-3YR": {
      list: 939,
      price: 492,
      discount: 0.476,
      zoho_product_id: "2570562000010635049",
      discount_per_unit: 447,
      discount_pct: 48
    },
    "LIC-MS390-48A-1Y": {
      list: 2923,
      price: 1429,
      discount: 0.5111,
      zoho_product_id: "2570562000025231472",
      discount_per_unit: 1494,
      discount_pct: 51
    },
    "LIC-MV-CA90-1YR": {
      list: 552,
      price: 371,
      discount: 0.3279,
      zoho_product_id: "2570562000012504180",
      discount_per_unit: 181,
      discount_pct: 33
    },
    "LIC-MX100-SDW-1Y": {
      list: 6771,
      price: 4553,
      discount: 0.3276,
      zoho_product_id: "2570562000034650466",
      discount_per_unit: 2218,
      discount_pct: 33
    },
    "LIC-MX64-SDW-1Y": {
      list: 1128,
      price: 759,
      discount: 0.3271,
      zoho_product_id: "2570562000034650481",
      discount_per_unit: 369,
      discount_pct: 33
    },
    "LIC-MS130-24-3Y": {
      list: 389,
      price: 203,
      discount: 0.4781,
      zoho_product_id: "2570562000182445394",
      discount_per_unit: 186,
      discount_pct: 48
    },
    "LIC-MX65W-SDW-3Y": {
      list: 3091,
      price: 2079,
      discount: 0.3274,
      zoho_product_id: "2570562000034650494",
      discount_per_unit: 1012,
      discount_pct: 33
    },
    "LIC-MV-CA365-3Y": {
      list: 6623,
      price: 4454,
      discount: 0.3275,
      zoho_product_id: "2570562000045027721",
      discount_per_unit: 2169,
      discount_pct: 33
    },
    "LIC-MX67W-SDW-5Y": {
      list: 3838,
      price: 1787,
      discount: 0.5344,
      zoho_product_id: "2570562000034650509",
      discount_per_unit: 2051,
      discount_pct: 53
    },
    "LIC-MX67C-ENT-5YR": {
      list: 1565,
      price: 730,
      discount: 0.5335,
      zoho_product_id: "2570562000010635050",
      discount_per_unit: 835,
      discount_pct: 53
    },
    "LIC-MS130-CMPT-3Y": {
      list: 151,
      price: 79,
      discount: 0.4768,
      zoho_product_id: "2570562000182445397",
      discount_per_unit: 72,
      discount_pct: 48
    },
    "LIC-MS130-48-3Y": {
      list: 672,
      price: 352,
      discount: 0.4762,
      zoho_product_id: "2570562000182445401",
      discount_per_unit: 320,
      discount_pct: 48
    },
    "LIC-MS390-24A-3Y": {
      list: 3560,
      price: 1740,
      discount: 0.5112,
      zoho_product_id: "2570562000025231476",
      discount_per_unit: 1820,
      discount_pct: 51
    },
    "LIC-MS390-24E-3Y": {
      list: 1562,
      price: 764,
      discount: 0.5109,
      zoho_product_id: "2570562000025231469",
      discount_per_unit: 798,
      discount_pct: 51
    },
    "LIC-MS120-8LP-1YR": {
      list: 59,
      price: 25,
      discount: 0.5763,
      zoho_product_id: "2570562000001259240",
      discount_per_unit: 34,
      discount_pct: 58
    },
    "LIC-Z3C-ENT-3YR": {
      list: 497,
      price: 300,
      discount: 0.3964,
      zoho_product_id: "2570562000010635036",
      discount_per_unit: 197,
      discount_pct: 40
    },
    "LIC-MX67W-SEC-5YR": {
      list: 2759,
      price: 1285,
      discount: 0.5343,
      zoho_product_id: "2570562000010201100",
      discount_per_unit: 1474,
      discount_pct: 53
    },
    "LIC-Z4C-ENT-1Y": {
      list: 290,
      price: 195,
      discount: 0.3276,
      zoho_product_id: "2570562000198467612",
      discount_per_unit: 95,
      discount_pct: 33
    },
    "LIC-MS130-24-1Y": {
      list: 173,
      price: 91,
      discount: 0.474,
      zoho_product_id: "2570562000182445408",
      discount_per_unit: 82,
      discount_pct: 47
    },
    "LIC-MS130-24-5Y": {
      list: 648,
      price: 339,
      discount: 0.4769,
      zoho_product_id: "2570562000182445410",
      discount_per_unit: 309,
      discount_pct: 48
    },
    "LIC-MS130-CMPT-1Y": {
      list: 67,
      price: 36,
      discount: 0.4627,
      zoho_product_id: "2570562000182445411",
      discount_per_unit: 31,
      discount_pct: 46
    },
    "LIC-Z4C-ENT-5Y": {
      list: 1087,
      price: 731,
      discount: 0.3275,
      zoho_product_id: "2570562000198467613",
      discount_per_unit: 356,
      discount_pct: 33
    },
    "LIC-Z4C-SEC-1Y": {
      list: 513,
      price: 346,
      discount: 0.3255,
      zoho_product_id: "2570562000198467614",
      discount_per_unit: 167,
      discount_pct: 33
    },
    "LIC-Z4C-SEC-5Y": {
      list: 1923,
      price: 1294,
      discount: 0.3271,
      zoho_product_id: "2570562000198467615",
      discount_per_unit: 629,
      discount_pct: 33
    },
    "LIC-MS130-48-1Y": {
      list: 298,
      price: 156,
      discount: 0.4765,
      zoho_product_id: "2570562000182445415",
      discount_per_unit: 142,
      discount_pct: 48
    },
    "LIC-MS130-48-5Y": {
      list: 1122,
      price: 587,
      discount: 0.4768,
      zoho_product_id: "2570562000182445416",
      discount_per_unit: 535,
      discount_pct: 48
    },
    "LIC-MS125-24-5Y": {
      list: 598,
      price: 252,
      discount: 0.5786,
      zoho_product_id: "2570562000019405058",
      discount_per_unit: 346,
      discount_pct: 58
    },
    "LIC-Z1-ENT-5YR": {
      list: 185,
      price: 116,
      discount: 0.373,
      zoho_product_id: "2570562000001097480",
      discount_per_unit: 69,
      discount_pct: 37
    },
    "LIC-MX60W-ENT-1YR": {
      list: 289,
      price: 195,
      discount: 0.3253,
      zoho_product_id: "2570562000001277697",
      discount_per_unit: 94,
      discount_pct: 33
    },
    "LIC-MX600-SEC-5YR": {
      list: 117745,
      price: 79174,
      discount: 0.3276,
      zoho_product_id: "2570562000001097642",
      discount_per_unit: 38571,
      discount_pct: 33
    },
    "LIC-MG51-ENT-1Y": {
      list: 432,
      price: 201,
      discount: 0.5347,
      zoho_product_id: "2570562000154200071",
      discount_per_unit: 231,
      discount_pct: 53
    },
    "LIC-MX68-ENT-5YR": {
      list: 1381,
      price: 644,
      discount: 0.5337,
      zoho_product_id: "2570562000010635055",
      discount_per_unit: 737,
      discount_pct: 53
    },
    "LIC-CLD-PEER-1YR": {
      list: 551925,
      price: 371122,
      discount: 41,
      zoho_product_id: "2570562000017212211",
      discount_per_unit: 180803,
      discount_pct: 33
    },
    "LIC-MS320-48FP-1YR": {
      list: 555,
      price: 374,
      discount: 0.3261,
      zoho_product_id: "2570562000001259375",
      discount_per_unit: 181,
      discount_pct: 33
    },
    "LIC-MX50-SEC-3YR": {
      list: 2e3,
      price: 1345,
      discount: 42,
      discount_per_unit: 655,
      discount_pct: 33
    },
    "LIC-MS220-24P-1YR": {
      list: 189,
      price: 128,
      discount: 0.3228,
      zoho_product_id: "2570562000001259285",
      discount_per_unit: 61,
      discount_pct: 32
    },
    "LIC-MX400-SEC-1YR": {
      list: 15699,
      price: 10556,
      discount: 0.3276,
      zoho_product_id: "2570562000001097620",
      discount_per_unit: 5143,
      discount_pct: 33
    },
    "LIC-MR-ADV-1Y": {
      list: 314,
      price: 211,
      discount: 0.328,
      zoho_product_id: "2570562000022573144",
      discount_per_unit: 103,
      discount_pct: 33
    },
    "LIC-MS355-48X-1YR": {
      list: 1205,
      price: 590,
      discount: 0.5104,
      zoho_product_id: "2570562000012504173",
      discount_per_unit: 615,
      discount_pct: 51
    },
    "LIC-MS355-24X-1YR": {
      list: 734,
      price: 359,
      discount: 0.5109,
      zoho_product_id: "2570562000012504167",
      discount_per_unit: 375,
      discount_pct: 51
    },
    "LIC-MS355-24X2-1YR": {
      list: 996,
      price: 487,
      discount: 0.511,
      zoho_product_id: "2570562000012504170",
      discount_per_unit: 509,
      discount_pct: 51
    },
    "LIC-MS355-48X2-1YR": {
      list: 1325,
      price: 647,
      discount: 0.5117,
      zoho_product_id: "2570562000012504176",
      discount_per_unit: 678,
      discount_pct: 51
    },
    "LIC-MS22-5YR": {
      list: 884,
      price: 595,
      discount: 0.3269,
      zoho_product_id: "2570562000001259217",
      discount_per_unit: 289,
      discount_pct: 33
    },
    "LIC-MS220-48FP-3YR": {
      list: 876,
      price: 590,
      discount: 0.3265,
      zoho_product_id: "2570562000001259301",
      discount_per_unit: 286,
      discount_pct: 33
    },
    "LIC-MX105-ENT-5Y": {
      list: 13799,
      price: 6424,
      discount: 0.5345,
      zoho_product_id: "2570562000064739425",
      discount_per_unit: 7375,
      discount_pct: 53
    },
    "LIC-MS22P-1YR": {
      list: 236,
      price: 159,
      discount: 0.3263,
      zoho_product_id: "2570562000001259220",
      discount_per_unit: 77,
      discount_pct: 33
    },
    "LIC-MS220-48FP-5YR": {
      list: 1460,
      price: 983,
      discount: 0.3267,
      zoho_product_id: "2570562000001259302",
      discount_per_unit: 477,
      discount_pct: 33
    },
    "LIC-MS320-48LP-1YR": {
      list: 508,
      price: 343,
      discount: 0.3248,
      zoho_product_id: "2570562000001259370",
      discount_per_unit: 165,
      discount_pct: 32
    },
    "LIC-MS250-24-3YR": {
      list: 1004,
      price: 491,
      discount: 0.511,
      zoho_product_id: "2570562000001094149",
      discount_per_unit: 513,
      discount_pct: 51
    },
    "LIC-MX50-SEC-1YR": {
      list: 1e3,
      price: 673,
      discount: 42,
      discount_per_unit: 327,
      discount_pct: 33
    },
    "LIC-MS22P-3YR": {
      list: 531,
      price: 357,
      discount: 0.3277,
      zoho_product_id: "2570562000001259221",
      discount_per_unit: 174,
      discount_pct: 33
    },
    "LIC-Z1-ENT-1YR": {
      list: 49,
      price: 31,
      discount: 0.3673,
      zoho_product_id: "2570562000001097478",
      discount_per_unit: 18,
      discount_pct: 37
    },
    "LIC-MX70-SEC-3YR": {
      list: 2e3,
      price: 1320,
      discount: 0.34,
      zoho_product_id: "2570562000001277751",
      discount_per_unit: 680,
      discount_pct: 34
    },
    "LIC-MS250-48LP-3YR": {
      list: 1606,
      price: 785,
      discount: 0.5112,
      zoho_product_id: "2570562000001094164",
      discount_per_unit: 821,
      discount_pct: 51
    },
    "LIC-MS225-48-3YR": {
      list: 962,
      price: 415,
      discount: 0.5686,
      zoho_product_id: "2570562000001094134",
      discount_per_unit: 547,
      discount_pct: 57
    },
    "LIC-MS225-48LP-1YR": {
      list: 515,
      price: 223,
      discount: 0.567,
      zoho_product_id: "2570562000001094138",
      discount_per_unit: 292,
      discount_pct: 57
    },
    "LIC-MX68CW-SEC-1YR": {
      list: 1031,
      price: 539,
      discount: 0.4772,
      zoho_product_id: "2570562000010635066",
      discount_per_unit: 492,
      discount_pct: 48
    },
    "LIC-MX67W-ENT-5YR": {
      list: 1381,
      price: 644,
      discount: 0.5337,
      zoho_product_id: "2570562000010635046",
      discount_per_unit: 737,
      discount_pct: 53
    },
    "LIC-C9300-48A-5Y": {
      list: 11628,
      price: 7017,
      discount: 0.3965,
      zoho_product_id: "2570562000199758025",
      discount_per_unit: 4611,
      discount_pct: 40
    },
    "LIC-MX80-SEC-3YR": {
      list: 4723,
      price: 3177,
      discount: 0.3273,
      zoho_product_id: "2570562000001277759",
      discount_per_unit: 1546,
      discount_pct: 33
    },
    "LIC-MS220-48LP-1YR": {
      list: 331,
      price: 223,
      discount: 0.3263,
      zoho_product_id: "2570562000001259295",
      discount_per_unit: 108,
      discount_pct: 33
    },
    "LIC-MS220-48FP-1YR": {
      list: 389,
      price: 262,
      discount: 0.3265,
      zoho_product_id: "2570562000001259300",
      discount_per_unit: 127,
      discount_pct: 33
    },
    "LIC-MS250-48-5YR": {
      list: 2326,
      price: 1137,
      discount: 0.5112,
      zoho_product_id: "2570562000001094160",
      discount_per_unit: 1189,
      discount_pct: 51
    },
    "LIC-MS250-48-3YR": {
      list: 1396,
      price: 683,
      discount: 0.5107,
      zoho_product_id: "2570562000001094159",
      discount_per_unit: 713,
      discount_pct: 51
    },
    "LIC-MS250-48LP-5YR": {
      list: 2675,
      price: 1308,
      discount: 0.511,
      zoho_product_id: "2570562000001094165",
      discount_per_unit: 1367,
      discount_pct: 51
    },
    "LIC-MS225-24P-1YR": {
      list: 359,
      price: 155,
      discount: 0.5682,
      zoho_product_id: "2570562000001094128",
      discount_per_unit: 204,
      discount_pct: 57
    },
    "LIC-MS250-24-5YR": {
      list: 1675,
      price: 818,
      discount: 0.5116,
      zoho_product_id: "2570562000001094150",
      discount_per_unit: 857,
      discount_pct: 51
    },
    "LIC-MS42-5YR": {
      list: 884,
      price: 595,
      discount: 0.3269,
      zoho_product_id: "2570562000001259227",
      discount_per_unit: 289,
      discount_pct: 33
    },
    "LIC-MX90-ENT-1YR": {
      list: 2099,
      price: 1413,
      discount: 0.3268,
      zoho_product_id: "2570562000001277773",
      discount_per_unit: 686,
      discount_pct: 33
    },
    "LIC-MS225-48FP-1YR": {
      list: 577,
      price: 249,
      discount: 0.5685,
      zoho_product_id: "2570562000001094143",
      discount_per_unit: 328,
      discount_pct: 57
    },
    "LIC-MS225-24P-3YR": {
      list: 809,
      price: 349,
      discount: 0.5686,
      zoho_product_id: "2570562000001094129",
      discount_per_unit: 460,
      discount_pct: 57
    },
    "LIC-MS250-24-1YR": {
      list: 447,
      price: 218,
      discount: 0.5123,
      zoho_product_id: "2570562000001094148",
      discount_per_unit: 229,
      discount_pct: 51
    },
    "LIC-MX105-ENT-1Y": {
      list: 3680,
      price: 2475,
      discount: 0.3274,
      zoho_product_id: "2570562000064739423",
      discount_per_unit: 1205,
      discount_pct: 33
    },
    "LIC-MS150-48-1Y": {
      list: 298,
      price: 129,
      discount: 0.5671,
      zoho_product_id: "2570562000288874916",
      discount_per_unit: 169,
      discount_pct: 57
    },
    "LIC-MS150-24-1Y": {
      list: 173,
      price: 75,
      discount: 0.5665,
      zoho_product_id: "2570562000288874879",
      discount_per_unit: 98,
      discount_pct: 57
    },
    "LIC-C9200L-48A-3Y": {
      list: 5716,
      price: 3845,
      discount: 0.3273,
      zoho_product_id: "2570562000320743668",
      discount_per_unit: 1871,
      discount_pct: 33
    },
    "LIC-MX64-SDW-5Y": {
      list: 4230,
      price: 2845,
      discount: 0.3274,
      zoho_product_id: "2570562000034650483",
      discount_per_unit: 1385,
      discount_pct: 33
    },
    "LIC-MX84-SDW-5Y": {
      list: 12693,
      price: 8536,
      discount: 0.3275,
      zoho_product_id: "2570562000034650529",
      discount_per_unit: 4157,
      discount_pct: 33
    },
    "LIC-MX68CW-SDW-1Y": {
      list: 1668,
      price: 872,
      discount: 0.4772,
      zoho_product_id: "2570562000034650517",
      discount_per_unit: 796,
      discount_pct: 48
    },
    "LIC-MX68CW-SDW-3Y": {
      list: 3753,
      price: 1963,
      discount: 0.477,
      zoho_product_id: "2570562000034650518",
      discount_per_unit: 1790,
      discount_pct: 48
    },
    "LIC-MX68CW-SDW-5Y": {
      list: 6255,
      price: 2913,
      discount: 0.5343,
      zoho_product_id: "2570562000034650519",
      discount_per_unit: 3342,
      discount_pct: 53
    },
    "LIC-MX65-SDW-5Y": {
      list: 4414,
      price: 2969,
      discount: 0.3274,
      zoho_product_id: "2570562000034650492",
      discount_per_unit: 1445,
      discount_pct: 33
    },
    "LIC-MX95-ENT-1Y": {
      list: 2453,
      price: 1649,
      discount: 0.3278,
      zoho_product_id: "2570562000064739408",
      discount_per_unit: 804,
      discount_pct: 33
    },
    "LIC-MX95-ENT-5Y": {
      list: 9197,
      price: 4282,
      discount: 0.5344,
      zoho_product_id: "2570562000064739410",
      discount_per_unit: 4915,
      discount_pct: 53
    },
    "LIC-MX65-SDW-3Y": {
      list: 2648,
      price: 1782,
      discount: 0.327,
      zoho_product_id: "2570562000034650491",
      discount_per_unit: 866,
      discount_pct: 33
    },
    "LIC-MX90-ENT-5YR": {
      list: 7872,
      price: 5294,
      discount: 0.3275,
      zoho_product_id: "2570562000001277775",
      discount_per_unit: 2578,
      discount_pct: 33
    },
    "LIC-MS390-48E-3Y": {
      list: 2805,
      price: 1371,
      discount: 0.5112,
      zoho_product_id: "2570562000025231470",
      discount_per_unit: 1434,
      discount_pct: 51
    },
    "LIC-MS220-24-5YR": {
      list: 531,
      price: 357,
      discount: 0.3277,
      zoho_product_id: "2570562000001259282",
      discount_per_unit: 174,
      discount_pct: 33
    },
    "LIC-MX65W-SDW-5Y": {
      list: 5152,
      price: 3464,
      discount: 0.3276,
      zoho_product_id: "2570562000034650495",
      discount_per_unit: 1688,
      discount_pct: 33
    },
    "LIC-MS150-48A-5Y": {
      list: 2243,
      price: 968,
      discount: 0.5684,
      zoho_product_id: "2570562000290749262",
      discount_per_unit: 1275,
      discount_pct: 57
    },
    "LIC-Z4C-ENT-3Y": {
      list: 652,
      price: 439,
      discount: 0.3267,
      zoho_product_id: "2570562000198375062",
      discount_per_unit: 213,
      discount_pct: 33
    },
    "MT40-HW": {
      list: 260,
      price: 118,
      discount: 0.5462,
      zoho_product_id: "2570562000162830800",
      discount_per_unit: 142,
      discount_pct: 55
    },
    "MA-MNT-MV-58": {
      list: 155,
      price: 105,
      discount: 0.3226,
      zoho_product_id: "2570562000125564898",
      discount_per_unit: 50,
      discount_pct: 32
    },
    "MA-MNT-MV-18": {
      list: 103,
      price: 70,
      discount: 0.3204,
      zoho_product_id: "2570562000154200067",
      discount_per_unit: 33,
      discount_pct: 32
    },
    "CAB-SPWR-150CM-M": {
      list: 263,
      price: 177,
      discount: 42,
      zoho_product_id: "2570562000246983834",
      discount_per_unit: 86,
      discount_pct: 33
    },
    "MA-SFP-10GB-SR": {
      list: 1217,
      price: 818,
      discount: 0.3279,
      zoho_product_id: "2570562000000159966",
      discount_per_unit: 399,
      discount_pct: 33
    },
    "MA-SFP-1GB-LX10": {
      list: 1217,
      price: 818,
      discount: 0.3279,
      zoho_product_id: "2570562000000159967",
      discount_per_unit: 399,
      discount_pct: 33
    },
    "C9300L-48T-4X-M": {
      list: 10793,
      price: 4156,
      discount: 0.6149,
      zoho_product_id: "2570562000238127277",
      discount_per_unit: 6637,
      discount_pct: 61
    },
    "MS150-24P-4X": {
      list: 5945,
      price: 2222,
      discount: 0.6262,
      zoho_product_id: "2570562000290749263",
      discount_per_unit: 3723,
      discount_pct: 63
    },
    "MS150-24T-4X": {
      list: 5083,
      price: 1899,
      discount: 0.6264,
      zoho_product_id: "2570562000290749264",
      discount_per_unit: 3184,
      discount_pct: 63
    },
    "CW9166I-MR": {
      list: 3051,
      price: 1561,
      discount: 0.4884,
      zoho_product_id: "2570562000112646019",
      discount_per_unit: 1490,
      discount_pct: 49
    },
    "MR78-HW": {
      list: 1833,
      price: 960,
      discount: 0.4763,
      zoho_product_id: "2570562000122475108",
      discount_per_unit: 873,
      discount_pct: 48
    },
    "MA-PWR-30WAC": {
      list: 99,
      price: 68,
      discount: 0.3131,
      zoho_product_id: "2570562000000159960",
      discount_per_unit: 31,
      discount_pct: 31
    },
    "MG51-HW": {
      list: 2003,
      price: 1347,
      discount: 0.3275,
      zoho_product_id: "2570562000154200070",
      discount_per_unit: 656,
      discount_pct: 33
    },
    "MA-MNT-MV-88": {
      list: 259,
      price: 175,
      discount: 0.3243,
      zoho_product_id: "2570562000154200052",
      discount_per_unit: 84,
      discount_pct: 32
    },
    "MA-ANT-DUAL-C1-O": {
      list: 1086,
      price: 731,
      discount: 42,
      zoho_product_id: "2570562000125794163",
      discount_per_unit: 355,
      discount_pct: 33
    },
    "C9300X-12Y-M": {
      list: 23496,
      price: 13200,
      discount: 0.4382,
      zoho_product_id: "2570562000223336736",
      discount_per_unit: 10296,
      discount_pct: 44
    },
    "MA-ANT-DUAL-C3-O": {
      list: 1039,
      price: 699,
      discount: 41,
      zoho_product_id: "2570562000261763058",
      discount_per_unit: 340,
      discount_pct: 33
    },
    "MA-MNT-CLG-1-O": {
      list: 31,
      price: 21,
      discount: 42,
      zoho_product_id: "2570562000001098885",
      discount_per_unit: 10,
      discount_pct: 32
    },
    "MA-MNT-MV-10-O": {
      list: 305,
      price: 205,
      discount: 42,
      zoho_product_id: "2570562000012504195",
      discount_per_unit: 100,
      discount_pct: 33
    },
    "MA-MNT-MV-11-O": {
      list: 121,
      price: 82,
      discount: 41,
      zoho_product_id: "2570562000034650533",
      discount_per_unit: 39,
      discount_pct: 32
    },
    "MA-MNT-MV-19-O": {
      list: 311,
      price: 209,
      discount: 42,
      zoho_product_id: "2570562000320743659",
      discount_per_unit: 102,
      discount_pct: 33
    },
    "MA-MNT-MV-20-O": {
      list: 305,
      price: 205,
      discount: 42,
      zoho_product_id: "2570562000012504196",
      discount_per_unit: 100,
      discount_pct: 33
    },
    "MA-MNT-MV-21-O": {
      list: 305,
      price: 205,
      discount: 42,
      zoho_product_id: "2570562000088970090",
      discount_per_unit: 100,
      discount_pct: 33
    },
    "MA-MNT-MV-29-O": {
      list: 103,
      price: 70,
      discount: 42,
      zoho_product_id: "2570562000320743660",
      discount_per_unit: 33,
      discount_pct: 32
    },
    "MA-MNT-MV-30-O": {
      list: 305,
      price: 205,
      discount: 42,
      zoho_product_id: "2570562000012504197",
      discount_per_unit: 100,
      discount_pct: 33
    },
    "MA-MNT-MV-31-O": {
      list: 305,
      price: 205,
      discount: 42,
      zoho_product_id: "2570562000012504198",
      discount_per_unit: 100,
      discount_pct: 33
    },
    "MA-MNT-MV-39-O": {
      list: 103,
      price: 70,
      discount: 42,
      zoho_product_id: "2570562000320743661",
      discount_per_unit: 33,
      discount_pct: 32
    },
    "MA-MNT-MV-40-O": {
      list: 488,
      price: 329,
      discount: 41,
      zoho_product_id: "2570562000019405039",
      discount_per_unit: 159,
      discount_pct: 33
    },
    "MA-MNT-MV-49-O": {
      list: 415,
      price: 279,
      discount: 42,
      zoho_product_id: "2570562000320743662",
      discount_per_unit: 136,
      discount_pct: 33
    },
    "MA-MNT-MV-59-O": {
      list: 415,
      price: 279,
      discount: 42,
      zoho_product_id: "2570562000320743663",
      discount_per_unit: 136,
      discount_pct: 33
    },
    "MA-MNT-MV-69-O": {
      list: 311,
      price: 209,
      discount: 42,
      zoho_product_id: "2570562000320743664",
      discount_per_unit: 102,
      discount_pct: 33
    },
    "MA-MNT-MV-79-O": {
      list: 363,
      price: 244,
      discount: 42,
      zoho_product_id: "2570562000320743665",
      discount_per_unit: 119,
      discount_pct: 33
    },
    "MA-MNT-MV-89-O": {
      list: 1350,
      price: 908,
      discount: 42,
      zoho_product_id: "2570562000320743666",
      discount_per_unit: 442,
      discount_pct: 33
    },
    "MV52-HW": {
      list: 3562,
      price: 2395,
      discount: 0.3276,
      zoho_product_id: "2570562000084083186",
      discount_per_unit: 1167,
      discount_pct: 33
    },
    "MA-MNT-MV-21": {
      list: 305,
      price: 206,
      discount: 0.3246,
      zoho_product_id: "2570562000088970090",
      discount_per_unit: 99,
      discount_pct: 32
    },
    MV32: {
      list: 1142,
      price: 769,
      discount: 0.3266,
      zoho_product_id: "2570562000016927096",
      discount_per_unit: 373,
      discount_pct: 33
    },
    "MA-PWR-30W-US-O": {
      list: 35,
      price: 24,
      discount: 41,
      zoho_product_id: "2570562000000161206",
      discount_per_unit: 11,
      discount_pct: 31
    },
    "C9200L-STA-KIT-M-O": {
      list: 1581,
      price: 882,
      discount: 52,
      zoho_product_id: "2570562000350341016",
      discount_per_unit: 699,
      discount_pct: 44
    },
    "STACK-T3A-1M-M": {
      list: 244,
      price: 160,
      discount: 0.3443,
      zoho_product_id: "2570562000261763084",
      discount_per_unit: 84,
      discount_pct: 34
    },
    "C9300L-STAK-KIT2-M": {
      list: 1596,
      price: 1074,
      discount: 0.3271,
      zoho_product_id: "2570562000224383202",
      discount_per_unit: 522,
      discount_pct: 33
    },
    MV72: {
      list: 1558,
      price: 1048,
      discount: 0.3273,
      zoho_product_id: "2570562000012504179",
      discount_per_unit: 510,
      discount_pct: 33
    },
    MV72X: {
      list: 1766,
      price: 1187,
      discount: 0.3279,
      zoho_product_id: "2570562000029952621",
      discount_per_unit: 579,
      discount_pct: 33
    },
    "MA-SFP-1GB-TX": {
      list: 531,
      price: 357,
      discount: 0.3277,
      zoho_product_id: "2570562000000159969",
      discount_per_unit: 174,
      discount_pct: 33
    },
    "MG52-HW": {
      list: 2307,
      price: 1318,
      discount: 0.4287,
      zoho_product_id: "2570562000239922051",
      discount_per_unit: 989,
      discount_pct: 43
    },
    "MA-PWR-30W-US": {
      list: 44,
      price: 30,
      discount: 0.3182,
      zoho_product_id: "2570562000000161206",
      discount_per_unit: 14,
      discount_pct: 32
    },
    "Z3C-HW-NA": {
      list: 1119,
      price: 753,
      discount: 41,
      zoho_product_id: "2570562000010553312",
      discount_per_unit: 366,
      discount_pct: 33
    },
    "MA-PWR-CORD-US-O": {
      list: 7,
      price: 5,
      discount: 42,
      zoho_product_id: "2570562000000159955",
      discount_per_unit: 2,
      discount_pct: 29
    },
    "MA-PWR-MV-LV-O": {
      list: 305,
      price: 205,
      discount: 42,
      zoho_product_id: "2570562000010635069",
      discount_per_unit: 100,
      discount_pct: 33
    },
    MV84X: {
      list: 8590,
      price: 5777,
      discount: 0.3275,
      zoho_product_id: "2570562000310730303",
      discount_per_unit: 2813,
      discount_pct: 33
    },
    "MA-MNT-MV-19": {
      list: 311,
      price: 209,
      discount: 0.328,
      zoho_product_id: "2570562000320743659",
      discount_per_unit: 102,
      discount_pct: 33
    },
    "MA-MNT-MV-29": {
      list: 103,
      price: 70,
      discount: 0.3204,
      zoho_product_id: "2570562000320743660",
      discount_per_unit: 33,
      discount_pct: 32
    },
    "MA-MNT-MV-39": {
      list: 207,
      price: 139,
      discount: 0.3285,
      zoho_product_id: "2570562000320743661",
      discount_per_unit: 68,
      discount_pct: 33
    },
    "MA-MNT-MV-49": {
      list: 415,
      price: 279,
      discount: 0.3277,
      zoho_product_id: "2570562000320743662",
      discount_per_unit: 136,
      discount_pct: 33
    },
    "MT10-HW": {
      list: 156,
      price: 71,
      discount: 0.5449,
      zoho_product_id: "2570562000041961841",
      discount_per_unit: 85,
      discount_pct: 54
    },
    "MT12-HW": {
      list: 156,
      price: 71,
      discount: 0.5449,
      zoho_product_id: "2570562000041961728",
      discount_per_unit: 85,
      discount_pct: 54
    },
    "MT20-HW": {
      list: 156,
      price: 71,
      discount: 0.5449,
      zoho_product_id: "2570562000041876794",
      discount_per_unit: 85,
      discount_pct: 54
    },
    "MA-CBL-LEAK-1": {
      list: 57,
      price: 39,
      discount: 0.3158,
      zoho_product_id: "2570562000043709567",
      discount_per_unit: 18,
      discount_pct: 32
    },
    "MS120-48-HW": {
      list: 3724,
      price: 1305,
      discount: 0.6496,
      zoho_product_id: "2570562000001259190",
      discount_per_unit: 2419,
      discount_pct: 65
    },
    "MS210-24-HW": {
      list: 4326,
      price: 1815,
      discount: 0.5804,
      zoho_product_id: "2570562000003355058",
      discount_per_unit: 2511,
      discount_pct: 58
    },
    "MS210-24P-HW": {
      list: 5309,
      price: 2228,
      discount: 0.5803,
      zoho_product_id: "2570562000001647058",
      discount_per_unit: 3081,
      discount_pct: 58
    },
    "MS210-48FP-HW": {
      list: 9516,
      price: 3993,
      discount: 0.5804,
      zoho_product_id: "2570562000001647061",
      discount_per_unit: 5523,
      discount_pct: 58
    },
    "MG21-HW-NA": {
      list: 1119,
      price: 753,
      discount: 41,
      zoho_product_id: "2570562000025231453",
      discount_per_unit: 366,
      discount_pct: 33
    },
    "CAB-SPWR-30CM-M": {
      list: 129,
      price: 87,
      discount: 42,
      zoho_product_id: "2570562000222867335",
      discount_per_unit: 42,
      discount_pct: 33
    },
    "STACK-T1-1M-M": {
      list: 240,
      price: 162,
      discount: 0.325,
      zoho_product_id: "2570562000198467606",
      discount_per_unit: 78,
      discount_pct: 32
    },
    "C9300-NM-8X-M": {
      list: 3119,
      price: 1703,
      discount: 0.454,
      zoho_product_id: "2570562000199758011",
      discount_per_unit: 1416,
      discount_pct: 45
    },
    "PWR-C1-1100WAC-P-M": {
      list: 2324,
      price: 1563,
      discount: 42,
      zoho_product_id: "2570562000217133358",
      discount_per_unit: 761,
      discount_pct: 33
    },
    "C9300-48UN-M": {
      list: 17967,
      price: 10017,
      discount: 0.4425,
      zoho_product_id: "2570562000199758012",
      discount_per_unit: 7950,
      discount_pct: 44
    },
    "MA-RCKMNT": {
      list: 415,
      price: 280,
      discount: 0.3253,
      zoho_product_id: "2570562000025231493",
      discount_per_unit: 135,
      discount_pct: 33
    },
    "MT15-HW": {
      list: 520,
      price: 349,
      discount: 0.3288,
      zoho_product_id: "2570562000189349673",
      discount_per_unit: 171,
      discount_pct: 33
    },
    "MA-MNT-MV-40": {
      list: 488,
      price: 329,
      discount: 0.3258,
      zoho_product_id: "2570562000019405039",
      discount_per_unit: 159,
      discount_pct: 33
    },
    "MA-MNT-MV-68": {
      list: 155,
      price: 105,
      discount: 0.3226,
      zoho_product_id: "2570562000125794165",
      discount_per_unit: 50,
      discount_pct: 32
    },
    "CW-ANT-O1-NS-00": {
      list: 260,
      price: 175,
      discount: 0.3269,
      zoho_product_id: "2570562000204583072",
      discount_per_unit: 85,
      discount_pct: 33
    },
    "CW9163E-MR": {
      list: 2803,
      price: 1402,
      discount: 0.4998,
      zoho_product_id: "2570562000204583049",
      discount_per_unit: 1401,
      discount_pct: 50
    },
    "MA-SFP-10GB-ZR": {
      list: 19570,
      price: 13160,
      discount: 0.3275,
      zoho_product_id: "2570562000019405041",
      discount_per_unit: 6410,
      discount_pct: 33
    },
    "C9300X-NM-2C-M": {
      list: 3119,
      price: 2098,
      discount: 0.3273,
      zoho_product_id: "2570562000221238452",
      discount_per_unit: 1021,
      discount_pct: 33
    },
    "C9300X-48HXN-M": {
      list: 18827,
      price: 10836,
      discount: 0.4244,
      zoho_product_id: "2570562000261763083",
      discount_per_unit: 7991,
      discount_pct: 42
    },
    "MT30-HW": {
      list: 156,
      price: 71,
      discount: 0.5449,
      zoho_product_id: "2570562000104250060",
      discount_per_unit: 85,
      discount_pct: 54
    },
    "MT14-HW": {
      list: 260,
      price: 118,
      discount: 0.5462,
      zoho_product_id: "2570562000104250061",
      discount_per_unit: 142,
      discount_pct: 55
    },
    "MA-PWR-MV-LV": {
      list: 305,
      price: 206,
      discount: 0.3246,
      zoho_product_id: "2570562000010635069",
      discount_per_unit: 99,
      discount_pct: 32
    },
    "MV12WE-HW": {
      list: 863,
      price: 580,
      discount: 0.3279,
      zoho_product_id: "2570562000004069112",
      discount_per_unit: 283,
      discount_pct: 33
    },
    "MX75-HW": {
      list: 2041,
      price: 951,
      discount: 0.5341,
      zoho_product_id: "2570562000064739443",
      discount_per_unit: 1090,
      discount_pct: 53
    },
    "MX85-HW": {
      list: 3171,
      price: 2132,
      discount: 0.3277,
      zoho_product_id: "2570562000064739444",
      discount_per_unit: 1039,
      discount_pct: 33
    },
    "MX95-HW": {
      list: 6348,
      price: 4269,
      discount: 0.3275,
      zoho_product_id: "2570562000064739445",
      discount_per_unit: 2079,
      discount_pct: 33
    },
    "MX105-HW": {
      list: 9525,
      price: 6405,
      discount: 0.3276,
      zoho_product_id: "2570562000064739446",
      discount_per_unit: 3120,
      discount_pct: 33
    },
    "MG41-HW": {
      list: 1804,
      price: 1214,
      discount: 0.3271,
      zoho_product_id: "2570562000064739447",
      discount_per_unit: 590,
      discount_pct: 33
    },
    "MG41E-HW": {
      list: 2113,
      price: 1422,
      discount: 0.327,
      zoho_product_id: "2570562000064739448",
      discount_per_unit: 691,
      discount_pct: 33
    },
    "MA-PWR-350WAC": {
      list: 825,
      price: 555,
      discount: 0.3273,
      zoho_product_id: "2570562000025231498",
      discount_per_unit: 270,
      discount_pct: 33
    },
    "MA-MNT-MR-14": {
      list: 60,
      price: 41,
      discount: 0.3167,
      zoho_product_id: "2570562000024235051",
      discount_per_unit: 19,
      discount_pct: 32
    },
    "MG51E-HW": {
      list: 2208,
      price: 1485,
      discount: 0.3274,
      zoho_product_id: "2570562000153238190",
      discount_per_unit: 723,
      discount_pct: 33
    },
    "MX67C-HW-WW": {
      list: 1779,
      price: 931,
      discount: 54,
      zoho_product_id: "2570562000035721715",
      discount_per_unit: 848,
      discount_pct: 48
    },
    "MA-PWR-USB-US": {
      list: 44,
      price: 30,
      discount: 0.3182,
      zoho_product_id: "2570562000049126054",
      discount_per_unit: 14,
      discount_pct: 32
    },
    "MA-MNT-MV-11": {
      list: 121,
      price: 82,
      discount: 0.3223,
      zoho_product_id: "2570562000034650533",
      discount_per_unit: 39,
      discount_pct: 32
    },
    "MA-ANT-3-C5": {
      list: 488,
      price: 329,
      discount: 0.3258,
      zoho_product_id: "2570562000003355089",
      discount_per_unit: 159,
      discount_pct: 33
    },
    "MA-MNT-MV-2": {
      list: 199,
      price: 131,
      discount: 0.3417,
      zoho_product_id: "2570562000000161182",
      discount_per_unit: 68,
      discount_pct: 34
    },
    "MV63M-HW": {
      list: 1832,
      price: 1232,
      discount: 0.3275,
      zoho_product_id: "2570562000260134527",
      discount_per_unit: 600,
      discount_pct: 33
    },
    "MV73X-HW": {
      list: 3206,
      price: 1892,
      discount: 0.4099,
      zoho_product_id: "2570562000261763065",
      discount_per_unit: 1314,
      discount_pct: 41
    },
    "MV73M-HW": {
      list: 2720.41,
      price: 1830,
      discount: 0.3273,
      zoho_product_id: "2570562000260134490",
      discount_per_unit: 890.41,
      discount_pct: 33
    },
    "MA-ANT-3-D6": {
      list: 641,
      price: 431,
      discount: 0.3276,
      zoho_product_id: "2570562000003355092",
      discount_per_unit: 210,
      discount_pct: 33
    },
    "MS225-48LP-HW": {
      list: 8563,
      price: 3593,
      discount: 0.5804,
      zoho_product_id: "2570562000000157381",
      discount_per_unit: 4970,
      discount_pct: 58
    },
    "MS250-24P-HW": {
      list: 8886,
      price: 3705,
      discount: 0.5831,
      zoho_product_id: "2570562000000157384",
      discount_per_unit: 5181,
      discount_pct: 58
    },
    "MS225-24P-HW": {
      list: 6026,
      price: 2529,
      discount: 0.5803,
      zoho_product_id: "2570562000000135183",
      discount_per_unit: 3497,
      discount_pct: 58
    },
    "MA-MNT-CLG-1": {
      list: 31,
      price: 21,
      discount: 0.3226,
      zoho_product_id: "2570562000001098885",
      discount_per_unit: 10,
      discount_pct: 32
    },
    "MX68CW-HW-NA": {
      list: 2465,
      price: 1290,
      discount: 0.4767,
      zoho_product_id: "2570562000010635040",
      discount_per_unit: 1175,
      discount_pct: 48
    },
    "MA-MNT-MID-1": {
      list: 92,
      price: 62,
      discount: 0.3261,
      zoho_product_id: "2570562000001098884",
      discount_per_unit: 30,
      discount_pct: 33
    },
    "MA-MNT-MR-15": {
      list: 60,
      price: 41,
      discount: 0.3167,
      zoho_product_id: "2570562000024235052",
      discount_per_unit: 19,
      discount_pct: 32
    },
    "MS225-24-HW": {
      list: 5174,
      price: 1933,
      discount: 0.6264,
      zoho_product_id: "2570562000000157379",
      discount_per_unit: 3241,
      discount_pct: 63
    },
    "MA-MNT-MV-3": {
      list: 199,
      price: 131,
      discount: 0.3417,
      zoho_product_id: "2570562000000161183",
      discount_per_unit: 68,
      discount_pct: 34
    },
    "MR36-HW": {
      list: 970,
      price: 508,
      discount: 0.4763,
      zoho_product_id: "2570562000028753805",
      discount_per_unit: 462,
      discount_pct: 48
    },
    "MR46-HW": {
      list: 2296,
      price: 1201,
      discount: 0.4769,
      zoho_product_id: "2570562000028840059",
      discount_per_unit: 1095,
      discount_pct: 48
    },
    "MT11-HW": {
      list: 156,
      price: 71,
      discount: 0.5449,
      zoho_product_id: "2570562000065238617",
      discount_per_unit: 85,
      discount_pct: 54
    },
    "MV33-HW": {
      list: 1373,
      price: 924,
      discount: 0.327,
      zoho_product_id: "2570562000212022663",
      discount_per_unit: 449,
      discount_pct: 33
    },
    "Z1-HW-AU": {
      list: 395,
      price: 266,
      discount: 41,
      discount_per_unit: 129,
      discount_pct: 33
    },
    "PWR-C5-125WAC-M-O": {
      list: 1946,
      price: 1309,
      discount: 41,
      zoho_product_id: "2570562000349456666",
      discount_per_unit: 637,
      discount_pct: 33
    },
    "MX67-HW": {
      list: 883,
      price: 412,
      discount: 59,
      zoho_product_id: "2570562000009234263",
      discount_per_unit: 471,
      discount_pct: 53
    },
    "PWR-C5-1KWAC-M-O": {
      list: 4170,
      price: 2805,
      discount: 41,
      zoho_product_id: "2570562000349456667",
      discount_per_unit: 1365,
      discount_pct: 33
    },
    "PWR-C5-600WAC-M-O": {
      list: 2780,
      price: 1870,
      discount: 42,
      zoho_product_id: "2570562000389299144",
      discount_per_unit: 910,
      discount_pct: 33
    },
    "STACK-T4-1M-M-O": {
      list: 278,
      price: 187,
      discount: 42,
      zoho_product_id: "2570562000389299184",
      discount_per_unit: 91,
      discount_pct: 33
    },
    "STACK-T4-3M-M-O": {
      list: 417,
      price: 281,
      discount: 42,
      zoho_product_id: "2570562000349456669",
      discount_per_unit: 136,
      discount_pct: 33
    },
    "STACK-T4-50CM-O": {
      list: 139,
      price: 94,
      discount: 41,
      zoho_product_id: "2570562000211391182",
      discount_per_unit: 45,
      discount_pct: 32
    },
    "C9300L-48PF-4X-M": {
      list: 14255,
      price: 5490,
      discount: 0.6149,
      zoho_product_id: "2570562000215181323",
      discount_per_unit: 8765,
      discount_pct: 61
    },
    "MA-ANT-C1-A": {
      list: 79,
      price: 54,
      discount: 0.3165,
      zoho_product_id: "2570562000028848051",
      discount_per_unit: 25,
      discount_pct: 32
    },
    "MX67W-HW": {
      list: 1366,
      price: 715,
      discount: 0.4766,
      zoho_product_id: "2570562000009567283",
      zoho_active: false,
      discount_per_unit: 651,
      discount_pct: 48
    },
    "MA-ANT-3-C6": {
      list: 610,
      price: 411,
      discount: 0.3262,
      zoho_product_id: "2570562000003355090",
      discount_per_unit: 199,
      discount_pct: 33
    },
    "MA-CBL-100G-3M": {
      list: 403,
      price: 271,
      discount: 0.3275,
      zoho_product_id: "2570562000012504193",
      discount_per_unit: 132,
      discount_pct: 33
    },
    "MX68-HW": {
      list: 1264,
      price: 589,
      discount: 59,
      zoho_product_id: "2570562000010523428",
      discount_per_unit: 675,
      discount_pct: 53
    },
    "FAN-T2-M": {
      list: 367,
      price: 239,
      discount: 0.3488,
      zoho_product_id: "2570562000261763074",
      discount_per_unit: 128,
      discount_pct: 35
    },
    "MA-MNT-MR-18": {
      list: 60,
      price: 41,
      discount: 0.3167,
      zoho_product_id: "2570562000042284052",
      discount_per_unit: 19,
      discount_pct: 32
    },
    "MA-MNT-MR-H1A": {
      list: 60,
      price: 41,
      discount: 0.3167,
      zoho_product_id: "2570562000154200060",
      discount_per_unit: 19,
      discount_pct: 32
    },
    "4PT-KIT-T2-M": {
      list: 273,
      price: 184,
      discount: 41,
      zoho_product_id: "2570562000285642381",
      discount_per_unit: 89,
      discount_pct: 33
    },
    "MA-MNT-MR-H3A": {
      list: 60,
      price: 41,
      discount: 0.3167,
      zoho_product_id: "2570562000154200053",
      discount_per_unit: 19,
      discount_pct: 32
    },
    "MA-ANT-3-E5": {
      list: 769,
      price: 517,
      discount: 0.3277,
      zoho_product_id: "2570562000003355093",
      discount_per_unit: 252,
      discount_pct: 33
    },
    "MA-QSFP-100G-LR4": {
      list: 40337,
      price: 27124,
      discount: 0.3276,
      zoho_product_id: "2570562000017212222",
      discount_per_unit: 13213,
      discount_pct: 33
    },
    "MA-QSFP-100G-SR4": {
      list: 2683,
      price: 1805,
      discount: 0.3272,
      zoho_product_id: "2570562000017212223",
      discount_per_unit: 878,
      discount_pct: 33
    },
    "MA-CBL-100G-50CM": {
      list: 134,
      price: 91,
      discount: 0.3209,
      zoho_product_id: "2570562000012504194",
      discount_per_unit: 43,
      discount_pct: 32
    },
    "MA-ANT-3-B5": {
      list: 207,
      price: 139,
      discount: 0.3285,
      zoho_product_id: "2570562000003355087",
      discount_per_unit: 68,
      discount_pct: 33
    },
    "MA-RCKMNT-KIT-1": {
      list: 2,
      price: 2,
      discount: 0,
      zoho_product_id: "2570562000080039875",
      discount_per_unit: 0,
      discount_pct: 0
    },
    "MA-ANT-3-A1": {
      list: 48,
      price: 32,
      discount: 0.3333,
      zoho_product_id: "2570562000003355083",
      discount_per_unit: 16,
      discount_pct: 33
    },
    "MA-ANT-DUAL-C1": {
      list: 1086,
      price: 731,
      discount: 0.3269,
      zoho_product_id: "2570562000125794163",
      discount_per_unit: 355,
      discount_pct: 33
    },
    "MA-ANT-3-E6": {
      list: 769,
      price: 517,
      discount: 0.3277,
      zoho_product_id: "2570562000003355094",
      discount_per_unit: 252,
      discount_pct: 33
    },
    "STACK-T1-3M-M": {
      list: 424,
      price: 286,
      discount: 0.3255,
      zoho_product_id: "2570562000198467607",
      discount_per_unit: 138,
      discount_pct: 33
    },
    "STACK-T1-50CM-M": {
      list: 129,
      price: 87,
      discount: 0.3256,
      zoho_product_id: "2570562000198467608",
      discount_per_unit: 42,
      discount_pct: 33
    },
    "PWR-C1-715WAC-P-M": {
      list: 1529,
      price: 1028,
      discount: 42,
      zoho_product_id: "2570562000217133404",
      discount_per_unit: 501,
      discount_pct: 33
    },
    "MA-PWR-CORD-JP": {
      list: 23,
      price: 16,
      discount: 41,
      discount_per_unit: 7,
      discount_pct: 30
    },
    "C9300X-NM-8Y-M": {
      list: 3119,
      price: 2098,
      discount: 0.3273,
      zoho_product_id: "2570562000210864266",
      discount_per_unit: 1021,
      discount_pct: 33
    },
    "C9300X-24Y-M": {
      list: 34552,
      price: 19788,
      discount: 0.4273,
      zoho_product_id: "2570562000210864243",
      discount_per_unit: 14764,
      discount_pct: 43
    },
    "MA-ANT-3-A5": {
      list: 207,
      price: 139,
      discount: 0.3285,
      zoho_product_id: "2570562000003355084",
      discount_per_unit: 68,
      discount_pct: 33
    },
    "MX250-HW": {
      list: 14100,
      price: 9482,
      discount: 0.3275,
      zoho_product_id: "2570562000001097489",
      discount_per_unit: 4618,
      discount_pct: 33
    },
    "MX450-HW": {
      list: 28206,
      price: 18967,
      discount: 0.3276,
      zoho_product_id: "2570562000001097491",
      discount_per_unit: 9239,
      discount_pct: 33
    },
    "MA-ANT-3-D5": {
      list: 512,
      price: 345,
      discount: 0.3262,
      zoho_product_id: "2570562000003355091",
      discount_per_unit: 167,
      discount_pct: 33
    },
    "MV12N-HW": {
      list: 971,
      price: 653,
      discount: 0.3275,
      zoho_product_id: "2570562000004069110",
      discount_per_unit: 318,
      discount_pct: 33
    },
    "MS125-24P-HW": {
      list: 4607,
      price: 1669,
      discount: 0.6377,
      zoho_product_id: "2570562000019405046",
      discount_per_unit: 2938,
      discount_pct: 64
    },
    "STACK-T3A-50CM-M": {
      list: 129,
      price: 84,
      discount: 0.3488,
      zoho_product_id: "2570562000261763086",
      discount_per_unit: 45,
      discount_pct: 35
    },
    "C9300L-24UXG-4X-M": {
      list: 11745,
      price: 7090,
      discount: 0.3963,
      zoho_product_id: "2570562000250332343",
      discount_per_unit: 4655,
      discount_pct: 40
    },
    "MR86-HW": {
      list: 3527,
      price: 2372,
      discount: 0.3275,
      zoho_product_id: "2570562000034650535",
      discount_per_unit: 1155,
      discount_pct: 33
    },
    "MA-MNT-MV-59": {
      list: 415,
      price: 279,
      discount: 0.3277,
      zoho_product_id: "2570562000320743663",
      discount_per_unit: 136,
      discount_pct: 33
    },
    "MA-MNT-MV-69": {
      list: 311,
      price: 209,
      discount: 0.328,
      zoho_product_id: "2570562000320743664",
      discount_per_unit: 102,
      discount_pct: 33
    },
    "MA-MNT-MV-79": {
      list: 363,
      price: 245,
      discount: 0.3251,
      zoho_product_id: "2570562000320743665",
      discount_per_unit: 118,
      discount_pct: 33
    },
    "MA-MNT-MV-89": {
      list: 1350,
      price: 908,
      discount: 0.3274,
      zoho_product_id: "2570562000320743666",
      discount_per_unit: 442,
      discount_pct: 33
    },
    "C9300L-24P-4X-M": {
      list: 8716,
      price: 3356,
      discount: 0.615,
      zoho_product_id: "2570562000217133381",
      discount_per_unit: 5360,
      discount_pct: 61
    },
    "MA-PWR-300WAC-ADP": {
      list: 622,
      price: 406,
      discount: 0.3473,
      zoho_product_id: "2570562000261763063",
      discount_per_unit: 216,
      discount_pct: 35
    },
    "MA-PWR-USB-JP": {
      list: 35,
      price: 24,
      discount: 41,
      discount_per_unit: 11,
      discount_pct: 31
    },
    "MA-PWR-715WAC": {
      list: 1584,
      price: 1066,
      discount: 0.327,
      zoho_product_id: "2570562000025231492",
      discount_per_unit: 518,
      discount_pct: 33
    },
    "CW-INJ-8": {
      list: 468,
      price: 315,
      discount: 0.3269,
      zoho_product_id: "2570562000290749261",
      discount_per_unit: 153,
      discount_pct: 33
    },
    "LIC-C8455-ENT-5Y": {
      list: 53021,
      price: 35653,
      discount: 0.3276,
      zoho_product_id: "2570562000385878053",
      discount_per_unit: 17368,
      discount_pct: 33
    },
    "LIC-C8455-ENT-3Y": {
      list: 31813,
      price: 21392,
      discount: 0.3276,
      zoho_product_id: "2570562000385878054",
      discount_per_unit: 10421,
      discount_pct: 33
    },
    "LIC-C8455-ENT-1Y": {
      list: 14139,
      price: 9508,
      discount: 0.3275,
      zoho_product_id: "2570562000385878055",
      discount_per_unit: 4631,
      discount_pct: 33
    },
    "CW9172H-RTG": {
      list: 1418,
      price: 743,
      discount: 0.476,
      zoho_product_id: "2570562000313607256",
      discount_per_unit: 675,
      discount_pct: 48
    },
    "MA-MNT-MR-H2": {
      list: 60,
      price: 41,
      discount: 0.3167,
      zoho_product_id: "2570562000003355115",
      discount_per_unit: 19,
      discount_pct: 32
    },
    "MA-CBL-TEMP-ME-1": {
      list: 78,
      price: 53,
      discount: 0.3205,
      zoho_product_id: "2570562000065238619",
      discount_per_unit: 25,
      discount_pct: 32
    },
    "C9300-48S-M": {
      list: 33999,
      price: 11988,
      discount: 0.6474,
      zoho_product_id: "2570562000261763088",
      discount_per_unit: 22011,
      discount_pct: 65
    },
    "MS150-48MP-4X": {
      list: 16057,
      price: 5999,
      discount: 0.6264,
      zoho_product_id: "2570562000288874549",
      discount_per_unit: 10058,
      discount_pct: 63
    },
    "MS150-48FP-4X": {
      list: 9442,
      price: 3528,
      discount: 0.6264,
      zoho_product_id: "2570562000288874485",
      discount_per_unit: 5914,
      discount_pct: 63
    },
    "MR44-HW": {
      list: 1579,
      price: 826,
      discount: 0.4769,
      zoho_product_id: "2570562000045149737",
      discount_per_unit: 753,
      discount_pct: 48
    },
    "MA-UMNT-MR-A3": {
      list: 37,
      price: 25,
      discount: 0.3243,
      zoho_product_id: "2570562000065238616",
      discount_per_unit: 12,
      discount_pct: 32
    },
    "MV33M-HW": {
      list: 1832,
      price: 1082,
      discount: 0.4094,
      zoho_product_id: "2570562000261763067",
      discount_per_unit: 750,
      discount_pct: 41
    },
    "C9300-48UXM-M": {
      list: 17470,
      price: 20700,
      discount: -0.1849,
      zoho_product_id: "2570562000199758017",
      discount_per_unit: -3230,
      discount_pct: -18
    },
    "C9300-24UX-M": {
      list: 17470,
      price: 9740,
      discount: 0.4425,
      zoho_product_id: "2570562000199758018",
      discount_per_unit: 7730,
      discount_pct: 44
    },
    "C9300-48U-M": {
      list: 14664,
      price: 8176,
      discount: 0.4424,
      zoho_product_id: "2570562000199758019",
      discount_per_unit: 6488,
      discount_pct: 44
    },
    "C9300-48P-M": {
      list: 13242,
      price: 7383,
      discount: 0.4425,
      zoho_product_id: "2570562000199758020",
      discount_per_unit: 5859,
      discount_pct: 44
    },
    "C9300-48T-M": {
      list: 11002,
      price: 10692,
      discount: 0.0282,
      zoho_product_id: "2570562000199758021",
      discount_per_unit: 310,
      discount_pct: 3
    },
    "C9300-24U-M": {
      list: 8404,
      price: 4685,
      discount: 0.4425,
      zoho_product_id: "2570562000199758022",
      discount_per_unit: 3719,
      discount_pct: 44
    },
    "C9300-24P-M": {
      list: 7692,
      price: 4289,
      discount: 0.4424,
      zoho_product_id: "2570562000199758023",
      discount_per_unit: 3403,
      discount_pct: 44
    },
    "C9300-24T-M": {
      list: 6551,
      price: 7686,
      discount: -0.1733,
      zoho_product_id: "2570562000199758024",
      discount_per_unit: -1135,
      discount_pct: -17
    },
    "OAD-CNS-MR-WPA": {
      list: 1,
      price: 1,
      discount: 41,
      zoho_product_id: "2570562000349456663",
      discount_per_unit: 0,
      discount_pct: 0
    },
    "MA-CBL-SPWR-150CM": {
      list: 275,
      price: 185,
      discount: 0.3273,
      zoho_product_id: "2570562000025231489",
      discount_per_unit: 90,
      discount_pct: 33
    },
    "MA-SFP-10GB-ER-O": {
      list: 12231,
      price: 8225,
      discount: 41,
      zoho_product_id: "2570562000019405040",
      discount_per_unit: 4006,
      discount_pct: 33
    },
    "MA-SFP-10GB-LR-O": {
      list: 4886,
      price: 3286,
      discount: 41,
      zoho_product_id: "2570562000000159964",
      discount_per_unit: 1600,
      discount_pct: 33
    },
    "MA-SFP-10GB-SR-O": {
      list: 1217,
      price: 819,
      discount: 42,
      zoho_product_id: "2570562000000159966",
      discount_per_unit: 398,
      discount_pct: 33
    },
    "MA-SFP-10GB-ZR-O": {
      list: 19570,
      price: 13159,
      discount: 42,
      zoho_product_id: "2570562000019405041",
      discount_per_unit: 6411,
      discount_pct: 33
    },
    "MA-SFP-1GB-LX10-O": {
      list: 1217,
      price: 819,
      discount: 42,
      zoho_product_id: "2570562000000159967",
      discount_per_unit: 398,
      discount_pct: 33
    },
    "MA-SFP-1GB-SX-O": {
      list: 612,
      price: 412,
      discount: 42,
      zoho_product_id: "2570562000000159968",
      discount_per_unit: 200,
      discount_pct: 33
    },
    "MA-SFP-1GB-TX-O": {
      list: 483,
      price: 325,
      discount: 41,
      zoho_product_id: "2570562000000159969",
      discount_per_unit: 158,
      discount_pct: 33
    },
    "MA-MNT-MV-18-O": {
      list: 103,
      price: 70,
      discount: 42,
      zoho_product_id: "2570562000154200067",
      discount_per_unit: 33,
      discount_pct: 32
    },
    "MA-MNT-MV-28-O": {
      list: 259,
      price: 174,
      discount: 42,
      zoho_product_id: "2570562000125565000",
      discount_per_unit: 85,
      discount_pct: 33
    },
    "MA-MNT-MV-38-O": {
      list: 259,
      price: 174,
      discount: 42,
      zoho_product_id: "2570562000125794164",
      discount_per_unit: 85,
      discount_pct: 33
    },
    "MA-MNT-MV-48-O": {
      list: 259,
      price: 174,
      discount: 42,
      zoho_product_id: "2570562000125564936",
      discount_per_unit: 85,
      discount_pct: 33
    },
    "MA-MNT-MV-58-O": {
      list: 155,
      price: 105,
      discount: 42,
      zoho_product_id: "2570562000125564898",
      discount_per_unit: 50,
      discount_pct: 32
    },
    "MA-MNT-MV-68-O": {
      list: 155,
      price: 105,
      discount: 42,
      zoho_product_id: "2570562000125794165",
      discount_per_unit: 50,
      discount_pct: 32
    },
    "MA-MNT-MV-78-O": {
      list: 467,
      price: 314,
      discount: 42,
      zoho_product_id: "2570562000125564917",
      discount_per_unit: 153,
      discount_pct: 33
    },
    "MA-MNT-MV-88-O": {
      list: 259,
      price: 174,
      discount: 42,
      zoho_product_id: "2570562000154200052",
      discount_per_unit: 85,
      discount_pct: 33
    },
    MV53X: {
      list: 3664,
      price: 2464,
      discount: 0.3275,
      zoho_product_id: "2570562000302894046",
      discount_per_unit: 1200,
      discount_pct: 33
    },
    "C9300X-48TX-M": {
      list: 18827,
      price: 10836,
      discount: 0.4244,
      zoho_product_id: "2570562000261763085",
      discount_per_unit: 7991,
      discount_pct: 42
    },
    "MA-MNT-MV-38": {
      list: 259,
      price: 175,
      discount: 0.3243,
      zoho_product_id: "2570562000125794164",
      discount_per_unit: 84,
      discount_pct: 32
    },
    "MA-MNT-ANT-5": {
      list: 151,
      price: 102,
      discount: 0.3245,
      zoho_product_id: "2570562000012504199",
      discount_per_unit: 49,
      discount_pct: 32
    },
    "MA-MNT-MV-20": {
      list: 305,
      price: 206,
      discount: 0.3246,
      zoho_product_id: "2570562000012504196",
      discount_per_unit: 99,
      discount_pct: 32
    },
    "MA-MNT-MV-30": {
      list: 305,
      price: 206,
      discount: 0.3246,
      zoho_product_id: "2570562000012504197",
      discount_per_unit: 99,
      discount_pct: 32
    },
    "MA-MNT-MV-31": {
      list: 305,
      price: 206,
      discount: 0.3246,
      zoho_product_id: "2570562000012504198",
      discount_per_unit: 99,
      discount_pct: 32
    },
    "MA-PWR-100WAC": {
      list: 244,
      price: 164,
      discount: 0.3279,
      zoho_product_id: "2570562000012504191",
      discount_per_unit: 80,
      discount_pct: 33
    },
    "MA-PWR-100WAC-A": {
      list: 197,
      price: 133,
      discount: 0.3249,
      zoho_product_id: "2570562000182445393",
      discount_per_unit: 64,
      discount_pct: 32
    },
    "MA-STND-1": {
      list: 69,
      price: 47,
      discount: 0.3188,
      zoho_product_id: "2570562000001279104",
      discount_per_unit: 22,
      discount_pct: 32
    },
    "MA-UMNT-MR-A2": {
      list: 37,
      price: 25,
      discount: 0.3243,
      zoho_product_id: "2570562000028845105",
      discount_per_unit: 12,
      discount_pct: 32
    },
    "MR46E-HW": {
      list: 2296,
      price: 1545,
      discount: 0.3271,
      zoho_product_id: "2570562000034650534",
      discount_per_unit: 751,
      discount_pct: 33
    },
    "MG52E-HW": {
      list: 2767,
      price: 1454,
      discount: 0.4745,
      zoho_product_id: "2570562000239922054",
      discount_per_unit: 1313,
      discount_pct: 47
    },
    "MV23X-HW": {
      list: 2748,
      price: 1622,
      discount: 0.4098,
      zoho_product_id: "2570562000261763066",
      discount_per_unit: 1126,
      discount_pct: 41
    },
    "MA-MNT-MV-62": {
      list: 245,
      price: 166,
      discount: 0.3224,
      zoho_product_id: "2570562000028848054",
      discount_per_unit: 79,
      discount_pct: 32
    },
    "MA-ANT-3-F5": {
      list: 1796,
      price: 1208,
      discount: 0.3274,
      zoho_product_id: "2570562000003355095",
      discount_per_unit: 588,
      discount_pct: 33
    },
    "CW-ANT-GPS1-M-00": {
      list: 364,
      price: 245,
      discount: 0.3269,
      zoho_product_id: "2570562000282151125",
      discount_per_unit: 119,
      discount_pct: 33
    },
    "MA-PWR-150WAC": {
      list: 428,
      price: 289,
      discount: 0.3248,
      zoho_product_id: "2570562000080039874",
      discount_per_unit: 139,
      discount_pct: 32
    },
    "MS130-8P-I-HW": {
      list: 1581,
      price: 918,
      discount: 0.4194,
      zoho_product_id: "2570562000235367001",
      discount_per_unit: 663,
      discount_pct: 42
    },
    "MV93-HW": {
      list: 1832,
      price: 938,
      discount: 0.488,
      zoho_product_id: "2570562000122474052",
      discount_per_unit: 894,
      discount_pct: 49
    },
    "PWR-C1-1900WAC-P-M": {
      list: 3180,
      price: 2139,
      discount: 42,
      zoho_product_id: "2570562000372896270",
      discount_per_unit: 1041,
      discount_pct: 33
    },
    "MA-ANT-3-F6": {
      list: 1796,
      price: 1208,
      discount: 0.3274,
      zoho_product_id: "2570562000003355096",
      discount_per_unit: 588,
      discount_pct: 33
    },
    "MA-ANT-LTE-1": {
      list: 61,
      price: 41,
      discount: 0.3279,
      zoho_product_id: "2570562000017212221",
      discount_per_unit: 20,
      discount_pct: 33
    },
    "MA-PWR-C14-C15-1": {
      list: 31,
      price: 21,
      discount: 0.3226,
      zoho_product_id: "2570562000179503506",
      discount_per_unit: 10,
      discount_pct: 32
    },
    "C9300X-48HX-M": {
      list: 20635,
      price: 13876,
      discount: 0.3276,
      zoho_product_id: "2570562000221238429",
      discount_per_unit: 6759,
      discount_pct: 33
    },
    "MA-ANT-3-A6": {
      list: 243,
      price: 164,
      discount: 0.3251,
      zoho_product_id: "2570562000003355085",
      discount_per_unit: 79,
      discount_pct: 33
    },
    "MA-ANT-3-B1": {
      list: 48,
      price: 32,
      discount: 0.3333,
      zoho_product_id: "2570562000003355086",
      discount_per_unit: 16,
      discount_pct: 33
    },
    "MA-MNT-ANT-4": {
      list: 121,
      price: 82,
      discount: 0.3223,
      zoho_product_id: "2570562000003355100",
      discount_per_unit: 39,
      discount_pct: 32
    },
    "MA-ANT-3-B6": {
      list: 243,
      price: 164,
      discount: 0.3251,
      zoho_product_id: "2570562000003355088",
      discount_per_unit: 79,
      discount_pct: 33
    },
    "MA-MNT-MV-63": {
      list: 306,
      price: 206,
      discount: 0.3268,
      zoho_product_id: "2570562000028848055",
      discount_per_unit: 100,
      discount_pct: 33
    },
    "MA-MNT-ANT-1": {
      list: 243,
      price: 164,
      discount: 0.3251,
      zoho_product_id: "2570562000003355097",
      discount_per_unit: 79,
      discount_pct: 33
    },
    "MA-MNT-ANT-2": {
      list: 243,
      price: 164,
      discount: 0.3251,
      zoho_product_id: "2570562000003355098",
      discount_per_unit: 79,
      discount_pct: 33
    },
    "MX68W-HW": {
      list: 1779,
      price: 931,
      discount: 0.4767,
      zoho_product_id: "2570562000010523059",
      discount_per_unit: 848,
      discount_pct: 48
    },
    "MS130R-8P-HW": {
      list: 4023,
      price: 2706,
      discount: 0.3274,
      zoho_product_id: "2570562000194740372",
      discount_per_unit: 1317,
      discount_pct: 33
    },
    "CW-MNT-ART2-00": {
      list: 208,
      price: 141,
      discount: 0.3221,
      zoho_product_id: "2570562000205715303",
      discount_per_unit: 67,
      discount_pct: 32
    },
    "MA-MNT-MR-12": {
      list: 60,
      price: 41,
      discount: 0.3167,
      zoho_product_id: "2570562000003355112",
      discount_per_unit: 19,
      discount_pct: 32
    },
    "MA-MNT-MR-13": {
      list: 84,
      price: 57,
      discount: 0.3214,
      zoho_product_id: "2570562000003355113",
      discount_per_unit: 27,
      discount_pct: 32
    },
    "MA-PWR-90WAC": {
      list: 244,
      price: 164,
      discount: 0.3279,
      zoho_product_id: "2570562000000159961",
      discount_per_unit: 80,
      discount_pct: 33
    },
    "MA-QSFP-40G-SR4": {
      list: 4028,
      price: 2709,
      discount: 0.3275,
      zoho_product_id: "2570562000000159970",
      discount_per_unit: 1319,
      discount_pct: 33
    },
    "MR57-HW": {
      list: 3418,
      price: 2299,
      discount: 0.3274,
      zoho_product_id: "2570562000095306439",
      discount_per_unit: 1119,
      discount_pct: 33
    },
    "MA-ANT-C2-A": {
      list: 52,
      price: 36,
      discount: 0.3077,
      zoho_product_id: "2570562000125794161",
      discount_per_unit: 16,
      discount_pct: 31
    },
    "MX68CW-HW-WW": {
      list: 2465,
      price: 1290,
      discount: 54,
      zoho_product_id: "2570562000019804126",
      discount_per_unit: 1175,
      discount_pct: 48
    },
    "IM-8-CU-1GB": {
      list: 3999,
      price: 2639,
      discount: 0.3401,
      zoho_product_id: "2570562000000159949",
      discount_per_unit: 1360,
      discount_pct: 34
    },
    "MA-QSFP-40G-CSR4": {
      list: 4028,
      price: 2709,
      discount: 0.3275,
      zoho_product_id: "2570562000000161172",
      discount_per_unit: 1319,
      discount_pct: 33
    },
    "MS425-16-HW": {
      list: 19178,
      price: 12896,
      discount: 41,
      zoho_product_id: "2570562000000157397",
      discount_per_unit: 6282,
      discount_pct: 33
    },
    "MA-CBL-LEAK-2": {
      list: 57,
      price: 39,
      discount: 0.3158,
      zoho_product_id: "2570562000125794156",
      discount_per_unit: 18,
      discount_pct: 32
    },
    "MA-QSFP-40G-LR4": {
      list: 13332,
      price: 8966,
      discount: 0.3275,
      zoho_product_id: "2570562000000159971",
      discount_per_unit: 4366,
      discount_pct: 33
    },
    "MA-QSFP-40G-SR-BD": {
      list: 1339,
      price: 901,
      discount: 0.3271,
      zoho_product_id: "2570562000000161173",
      discount_per_unit: 438,
      discount_pct: 33
    },
    "CW9166D1-MR": {
      list: 3418,
      price: 1437,
      discount: 0.5796,
      zoho_product_id: "2570562000246993136",
      discount_per_unit: 1981,
      discount_pct: 58
    },
    "MS350-24X-HW": {
      list: 9930,
      price: 6678,
      discount: 0.3275,
      zoho_product_id: "2570562000000157391",
      discount_per_unit: 3252,
      discount_pct: 33
    },
    "MA-MNT-ANT-6": {
      list: 103,
      price: 66,
      discount: 0.3592,
      zoho_product_id: "2570562000154200062",
      discount_per_unit: 37,
      discount_pct: 36
    },
    "MA-CBL-120G-3M": {
      list: 459,
      price: 309,
      discount: 0.3268,
      zoho_product_id: "2570562000025231499",
      discount_per_unit: 150,
      discount_pct: 33
    },
    "STACK-T3A-3M-M": {
      list: 367,
      price: 239,
      discount: 0.3488,
      zoho_product_id: "2570562000261763087",
      discount_per_unit: 128,
      discount_pct: 35
    },
    "MV22-HW": {
      list: 1403,
      price: 944,
      discount: 42,
      discount_per_unit: 459,
      discount_pct: 33
    },
    "MR76-HW": {
      list: 2534,
      price: 1325,
      discount: 0.4771,
      zoho_product_id: "2570562000034080533",
      discount_per_unit: 1209,
      discount_pct: 48
    },
    "MA-SFP-10GB-LRM": {
      list: 1217,
      price: 818,
      discount: 0.3279,
      zoho_product_id: "2570562000000159965",
      discount_per_unit: 399,
      discount_pct: 33
    },
    "MX100-HW": {
      list: 6758,
      price: 4544,
      discount: 42,
      zoho_product_id: "2570562000000159814",
      discount_per_unit: 2214,
      discount_pct: 33
    },
    "Z1-HW-UK": {
      list: 395,
      price: 266,
      discount: 41,
      discount_per_unit: 129,
      discount_pct: 33
    },
    "MV13-HW": {
      list: 1144,
      price: 770,
      discount: 0.3269,
      zoho_product_id: "2570562000212022694",
      discount_per_unit: 374,
      discount_pct: 33
    },
    "CW9800H1-MCG": {
      list: 129642,
      price: 87174,
      discount: 0.3276,
      zoho_product_id: "2570562000326331519",
      discount_per_unit: 42468,
      discount_pct: 33
    },
    "MS450-12-HW": {
      list: 29464,
      price: 19813,
      discount: 0.3276,
      zoho_product_id: "2570562000017212224",
      discount_per_unit: 9651,
      discount_pct: 33
    },
    "C9300-NM-2Q-M": {
      list: 3119,
      price: 1703,
      discount: 0.454,
      zoho_product_id: "2570562000199758029",
      discount_per_unit: 1416,
      discount_pct: 45
    },
    "MV22X-HW": {
      list: 1618,
      price: 1089,
      discount: 0.3269,
      zoho_product_id: "2570562000029952620",
      discount_per_unit: 529,
      discount_pct: 33
    },
    "C9300L-48UXG-4X-M": {
      list: 18728,
      price: 12594,
      discount: 0.3275,
      zoho_product_id: "2570562000226646510",
      discount_per_unit: 6134,
      discount_pct: 33
    },
    "MA-FAN-16K2": {
      list: 367,
      price: 247,
      discount: 0.327,
      zoho_product_id: "2570562000025231491",
      discount_per_unit: 120,
      discount_pct: 33
    },
    "MA-WMNTBR-PWR-ADP": {
      list: 104,
      price: 68,
      discount: 0.3462,
      zoho_product_id: "2570562000261763080",
      discount_per_unit: 36,
      discount_pct: 35
    },
    "MA-ANT-MX": {
      list: 31,
      price: 21,
      discount: 0.3226,
      zoho_product_id: "2570562000000161179",
      discount_per_unit: 10,
      discount_pct: 32
    },
    "PWR-C1-350WAC-P-M": {
      list: 795,
      price: 536,
      discount: 0.3258,
      zoho_product_id: "2570562000300080764",
      discount_per_unit: 259,
      discount_pct: 33
    },
    "MA-CBL-40G-1M": {
      list: 269,
      price: 182,
      discount: 0.3234,
      zoho_product_id: "2570562000000161177",
      discount_per_unit: 87,
      discount_pct: 32
    },
    "MS150-48LP-4X": {
      list: 8403,
      price: 3237,
      discount: 0.6148,
      zoho_product_id: "2570562000288888390",
      discount_per_unit: 5166,
      discount_pct: 61
    },
    "MA-CBL-40G-3M": {
      list: 403,
      price: 272,
      discount: 0.3251,
      zoho_product_id: "2570562000000161178",
      discount_per_unit: 131,
      discount_pct: 33
    },
    "C9200L-STAK-KIT-M": {
      list: 1581,
      price: 882,
      discount: 0.4421,
      zoho_product_id: "2570562000349456664",
      discount_per_unit: 699,
      discount_pct: 44
    },
    "PWR-C5-600WAC-M": {
      list: 2780,
      price: 1870,
      discount: 0.3273,
      zoho_product_id: "2570562000349456665",
      discount_per_unit: 910,
      discount_pct: 33
    },
    "MS210-48LP-HW": {
      list: 7210,
      price: 3025,
      discount: 0.5804,
      zoho_product_id: "2570562000001647060",
      discount_per_unit: 4185,
      discount_pct: 58
    },
    "MS350-48-HW": {
      list: 12598,
      price: 8471,
      discount: 0.3276,
      zoho_product_id: "2570562000000157392",
      discount_per_unit: 4127,
      discount_pct: 33
    },
    "PWR-C5-125WAC-M": {
      list: 1946,
      price: 1309,
      discount: 0.3273,
      zoho_product_id: "2570562000349456666",
      discount_per_unit: 637,
      discount_pct: 33
    },
    "PWR-C5-1KWAC-M": {
      list: 4170,
      price: 2805,
      discount: 0.3273,
      zoho_product_id: "2570562000349456667",
      discount_per_unit: 1365,
      discount_pct: 33
    },
    "STACK-T4-1M-M": {
      list: 278,
      price: 187,
      discount: 0.3273,
      zoho_product_id: "2570562000349456668",
      discount_per_unit: 91,
      discount_pct: 33
    },
    "STACK-T4-3M-M": {
      list: 417,
      price: 280,
      discount: 0.3285,
      zoho_product_id: "2570562000349456669",
      discount_per_unit: 137,
      discount_pct: 33
    },
    "STACK-T4-50CM-M": {
      list: 139,
      price: 94,
      discount: 0.3237,
      zoho_product_id: "2570562000349456670",
      discount_per_unit: 45,
      discount_pct: 32
    },
    "MR52-HW": {
      list: 1711,
      price: 1151,
      discount: 41,
      zoho_product_id: "2570562000000161187",
      discount_per_unit: 560,
      discount_pct: 33
    },
    "MA-CBL-TA-3M": {
      list: 202,
      price: 137,
      discount: 0.3218,
      zoho_product_id: "2570562000000161175",
      discount_per_unit: 65,
      discount_pct: 32
    },
    "MA-FAN-16K": {
      list: 382,
      price: 257,
      discount: 0.3272,
      zoho_product_id: "2570562000000159963",
      discount_per_unit: 125,
      discount_pct: 33
    },
    "MA-PWR-250WAC": {
      list: 687,
      price: 463,
      discount: 0.3261,
      zoho_product_id: "2570562000000159956",
      discount_per_unit: 224,
      discount_pct: 33
    },
    "MA-CBL-40G-50CM": {
      list: 134,
      price: 91,
      discount: 0.3209,
      zoho_product_id: "2570562000000161176",
      discount_per_unit: 43,
      discount_pct: 32
    },
    "MA-FAN-18K": {
      list: 382,
      price: 257,
      discount: 0.3272,
      zoho_product_id: "2570562000000159962",
      discount_per_unit: 125,
      discount_pct: 33
    },
    "MA-CBL-100G-1M-O": {
      list: 245,
      price: 165,
      discount: 42,
      zoho_product_id: "2570562000012504192",
      discount_per_unit: 80,
      discount_pct: 33
    },
    "MA-CBL-100G-3M-O": {
      list: 367,
      price: 247,
      discount: 42,
      zoho_product_id: "2570562000012504193",
      discount_per_unit: 120,
      discount_pct: 33
    },
    "MA-CBL-100G-50CM-O": {
      list: 122,
      price: 83,
      discount: 41,
      zoho_product_id: "2570562000376823002",
      discount_per_unit: 39,
      discount_pct: 32
    },
    "MS350-48FP-HW": {
      list: 15937,
      price: 10717,
      discount: 0.3275,
      zoho_product_id: "2570562000000157394",
      discount_per_unit: 5220,
      discount_pct: 33
    },
    "MA-PWR-1025WAC": {
      list: 2215,
      price: 1490,
      discount: 0.3273,
      zoho_product_id: "2570562000000159958",
      discount_per_unit: 725,
      discount_pct: 33
    },
    "MS210-48-HW": {
      list: 5695,
      price: 2390,
      discount: 0.5803,
      zoho_product_id: "2570562000001647059",
      discount_per_unit: 3305,
      discount_pct: 58
    },
    "MA-CBL-TA-1M-O": {
      list: 122,
      price: 83,
      discount: 41,
      zoho_product_id: "2570562000000161174",
      discount_per_unit: 39,
      discount_pct: 32
    },
    "MA-CBL-TA-3M-O": {
      list: 183,
      price: 124,
      discount: 41,
      zoho_product_id: "2570562000000161175",
      discount_per_unit: 59,
      discount_pct: 32
    },
    "MA-PWR-640WAC": {
      list: 1451,
      price: 976,
      discount: 0.3274,
      zoho_product_id: "2570562000000159957",
      discount_per_unit: 475,
      discount_pct: 33
    },
    "MS150-24T-4G": {
      list: 3557,
      price: 1370,
      discount: 0.6148,
      zoho_product_id: "2570562000290749265",
      discount_per_unit: 2187,
      discount_pct: 61
    },
    "MS150-24P-4G": {
      list: 4428,
      price: 1654,
      discount: 0.6265,
      zoho_product_id: "2570562000290749266",
      discount_per_unit: 2774,
      discount_pct: 63
    },
    "MS150-48T-4G": {
      list: 5299,
      price: 1980,
      discount: 0.6263,
      zoho_product_id: "2570562000290749267",
      discount_per_unit: 3319,
      discount_pct: 63
    },
    "MS150-48LP-4G": {
      list: 6878,
      price: 2649,
      discount: 0.6149,
      zoho_product_id: "2570562000290749268",
      discount_per_unit: 4229,
      discount_pct: 61
    },
    "MS150-48FP-4G": {
      list: 7916,
      price: 3048,
      discount: 0.615,
      zoho_product_id: "2570562000290749269",
      discount_per_unit: 4868,
      discount_pct: 61
    },
    "MS150-48T-4X": {
      list: 6826,
      price: 2551,
      discount: 0.6263,
      zoho_product_id: "2570562000289228179",
      discount_per_unit: 4275,
      discount_pct: 63
    },
    "MA-SFP-10GB-ER": {
      list: 12231,
      price: 8225,
      discount: 0.3275,
      zoho_product_id: "2570562000019405040",
      discount_per_unit: 4006,
      discount_pct: 33
    },
    "C9300-24S-M": {
      list: 30447,
      price: 8586,
      discount: 0.718,
      zoho_product_id: "2570562000226337120",
      discount_per_unit: 21861,
      discount_pct: 72
    },
    "Z4-HW": {
      list: 810,
      price: 377,
      discount: 0.5346,
      zoho_product_id: "2570562000161073001",
      discount_per_unit: 433,
      discount_pct: 53
    },
    "CW9164I-MR": {
      list: 2685,
      price: 1343,
      discount: 0.4998,
      zoho_product_id: "2570562000112646005",
      discount_per_unit: 1342,
      discount_pct: 50
    },
    "MX67C-HW-NA": {
      list: 1779,
      price: 931,
      discount: 0.4767,
      zoho_product_id: "2570562000010635038",
      discount_per_unit: 848,
      discount_pct: 48
    },
    "MA-MNT-ANT-3": {
      list: 121,
      price: 82,
      discount: 0.3223,
      zoho_product_id: "2570562000003355099",
      discount_per_unit: 39,
      discount_pct: 32
    },
    "CW-ANT-D1-NS-00": {
      list: 1428,
      price: 929,
      discount: 0.3494,
      zoho_product_id: "2570562000243995311",
      discount_per_unit: 499,
      discount_pct: 35
    },
    "CW-ANT-GPS2-S-00": {
      list: 353,
      price: 238,
      discount: 0.3258,
      zoho_product_id: "2570562000198467611",
      discount_per_unit: 115,
      discount_pct: 33
    },
    "MV23M-HW": {
      list: 2175,
      price: 1463,
      discount: 0.3274,
      zoho_product_id: "2570562000260134601",
      discount_per_unit: 712,
      discount_pct: 33
    },
    "MV13M-HW": {
      list: 1488,
      price: 1001,
      discount: 0.3273,
      zoho_product_id: "2570562000260134564",
      discount_per_unit: 487,
      discount_pct: 33
    },
    "MV93M-HW": {
      list: 2290,
      price: 1540,
      discount: 0.3275,
      zoho_product_id: "2570562000260134453",
      discount_per_unit: 750,
      discount_pct: 33
    },
    "MV63X-HW": {
      list: 2863,
      price: 1464,
      discount: 0.4886,
      zoho_product_id: "2570562000123011184",
      discount_per_unit: 1399,
      discount_pct: 49
    },
    "MA-MNT-MV-28": {
      list: 259,
      price: 175,
      discount: 0.3243,
      zoho_product_id: "2570562000125565000",
      discount_per_unit: 84,
      discount_pct: 32
    },
    "MA-MNT-MV-48": {
      list: 259,
      price: 175,
      discount: 0.3243,
      zoho_product_id: "2570562000125564936",
      discount_per_unit: 84,
      discount_pct: 32
    },
    "MS130-24X-HW": {
      list: 6324,
      price: 3671,
      discount: 0.4195,
      zoho_product_id: "2570562000182445395",
      discount_per_unit: 2653,
      discount_pct: 42
    },
    "CW9162I-MR": {
      list: 1523,
      price: 726,
      discount: 0.5233,
      zoho_product_id: "2570562000125794160",
      discount_per_unit: 797,
      discount_pct: 52
    },
    "MA-MNT-MR-17": {
      list: 60,
      price: 41,
      discount: 0.3167,
      zoho_product_id: "2570562000034650532",
      discount_per_unit: 19,
      discount_pct: 32
    },
    "MS130-24P-HW": {
      list: 3443,
      price: 1999,
      discount: 0.4194,
      zoho_product_id: "2570562000182445396",
      discount_per_unit: 1444,
      discount_pct: 42
    },
    "C9300L-48P-4X-M": {
      list: 12812,
      price: 4934,
      discount: 0.6149,
      zoho_product_id: "2570562000215181346",
      discount_per_unit: 7878,
      discount_pct: 61
    },
    "MS130-8P-HW": {
      list: 1581,
      price: 918,
      discount: 0.4194,
      zoho_product_id: "2570562000182445398",
      discount_per_unit: 663,
      discount_pct: 42
    },
    "MR36H-HW": {
      list: 1152,
      price: 602,
      discount: 0.4774,
      zoho_product_id: "2570562000090052298",
      discount_per_unit: 550,
      discount_pct: 48
    },
    "MS130-48P-HW": {
      list: 6151,
      price: 3571,
      discount: 0.4194,
      zoho_product_id: "2570562000182445400",
      discount_per_unit: 2580,
      discount_pct: 42
    },
    "C9200L-24P-4G-M": {
      list: 3562,
      price: 1454,
      discount: 0.5918,
      zoho_product_id: "2570562000349456671",
      discount_per_unit: 2108,
      discount_pct: 59
    },
    "C9200L-24P-4X-M": {
      list: 5469,
      price: 2107,
      discount: 0.6147,
      zoho_product_id: "2570562000349456672",
      discount_per_unit: 3362,
      discount_pct: 61
    },
    "C9200L-24PXG-2Y-M": {
      list: 9460,
      price: 6362,
      discount: 0.3275,
      zoho_product_id: "2570562000349456673",
      discount_per_unit: 3098,
      discount_pct: 33
    },
    "C9200L-24PXG-4X-M": {
      list: 8746,
      price: 5882,
      discount: 0.3275,
      zoho_product_id: "2570562000349456674",
      discount_per_unit: 2864,
      discount_pct: 33
    },
    "C9200L-24T-4G-M": {
      list: 2473,
      price: 982,
      discount: 0.6029,
      zoho_product_id: "2570562000349456675",
      discount_per_unit: 1491,
      discount_pct: 60
    },
    "C9200L-24T-4X-M": {
      list: 4380,
      price: 2040,
      discount: 0.5342,
      zoho_product_id: "2570562000349456676",
      discount_per_unit: 2340,
      discount_pct: 53
    },
    "C9200L-48P-4G-M": {
      list: 7533,
      price: 2901,
      discount: 0.6149,
      zoho_product_id: "2570562000349456677",
      discount_per_unit: 4632,
      discount_pct: 61
    },
    "C9200L-48P-4X-M": {
      list: 9440,
      price: 3636,
      discount: 0.6148,
      zoho_product_id: "2570562000349456678",
      discount_per_unit: 5804,
      discount_pct: 61
    },
    "C9200L-48PL-4G-M": {
      list: 6236,
      price: 2402,
      discount: 0.6148,
      zoho_product_id: "2570562000349456679",
      discount_per_unit: 3834,
      discount_pct: 61
    },
    "MA-PWR-50WAC": {
      list: 153,
      price: 103,
      discount: 0.3268,
      zoho_product_id: "2570562000003355117",
      discount_per_unit: 50,
      discount_pct: 33
    },
    "MA-PWR300WINDADP-O": {
      list: 830,
      price: 559,
      discount: 41,
      discount_per_unit: 271,
      discount_pct: 33
    },
    "MA-PWR-C14-C15-1-O": {
      list: 31,
      price: 21,
      discount: 42,
      zoho_product_id: "2570562000179503506",
      discount_per_unit: 10,
      discount_pct: 32
    },
    "MA-PWR-ETH-O": {
      list: 182,
      price: 123,
      discount: 41,
      zoho_product_id: "2570562000080039876",
      discount_per_unit: 59,
      discount_pct: 32
    },
    "MA-PWR-USB-US-O": {
      list: 35,
      price: 24,
      discount: 41,
      zoho_product_id: "2570562000049126054",
      discount_per_unit: 11,
      discount_pct: 31
    },
    "MA-RCKMNT-KIT-1-O": {
      list: 2,
      price: 2,
      discount: 39,
      zoho_product_id: "2570562000080039875",
      discount_per_unit: 0,
      discount_pct: 0
    },
    "MA-SFP-10GB-LRM-O": {
      list: 1217,
      price: 819,
      discount: 42,
      zoho_product_id: "2570562000000159965",
      discount_per_unit: 398,
      discount_pct: 33
    },
    "C9200L-48PL-4X-M": {
      list: 8144,
      price: 3137,
      discount: 0.6148,
      zoho_product_id: "2570562000349456680",
      discount_per_unit: 5007,
      discount_pct: 61
    },
    "C9200L-48PXG-2Y-M": {
      list: 14184,
      price: 9538,
      discount: 0.3276,
      zoho_product_id: "2570562000349456681",
      discount_per_unit: 4646,
      discount_pct: 33
    },
    "C9200L-48PXG-4X-M": {
      list: 13470,
      price: 9059,
      discount: 0.3275,
      zoho_product_id: "2570562000349456682",
      discount_per_unit: 4411,
      discount_pct: 33
    },
    "C9200L-48T-4G-M": {
      list: 4263,
      price: 1740,
      discount: 0.5918,
      zoho_product_id: "2570562000349456683",
      discount_per_unit: 2523,
      discount_pct: 59
    },
    "C9200L-48T-4X-M": {
      list: 6171,
      price: 2874,
      discount: 0.5343,
      zoho_product_id: "2570562000349456684",
      discount_per_unit: 3297,
      discount_pct: 53
    },
    "MX67C-NA": {
      list: 1712,
      price: 896,
      discount: 54,
      zoho_product_id: "2570562000392754775",
      discount_per_unit: 816,
      discount_pct: 48
    },
    "MX68CW-NA": {
      list: 2373,
      price: 1241,
      discount: 55,
      zoho_product_id: "2570562000010635040",
      discount_per_unit: 1132,
      discount_pct: 48
    },
    "MA-CBL-LEAK-1-O": {
      list: 57,
      price: 39,
      discount: 41,
      zoho_product_id: "2570562000043709567",
      discount_per_unit: 18,
      discount_pct: 32
    },
    "MA-CBL-LEAK-2-O": {
      list: 57,
      price: 39,
      discount: 41,
      zoho_product_id: "2570562000125794156",
      discount_per_unit: 18,
      discount_pct: 32
    },
    "MA-CBL-TEMP-GL-1-O": {
      list: 78,
      price: 53,
      discount: 42,
      zoho_product_id: "2570562000065238618",
      discount_per_unit: 25,
      discount_pct: 32
    },
    "MA-CBL-TEMP-ME-1-O": {
      list: 78,
      price: 53,
      discount: 42,
      zoho_product_id: "2570562000065238619",
      discount_per_unit: 25,
      discount_pct: 32
    },
    "MA-MNT-MR-16": {
      list: 60,
      price: 41,
      discount: 0.3167,
      zoho_product_id: "2570562000034650531",
      discount_per_unit: 19,
      discount_pct: 32
    },
    "MA-PWR-CORD-US": {
      list: 9,
      price: 7,
      discount: 0.2222,
      zoho_product_id: "2570562000000159955",
      discount_per_unit: 2,
      discount_pct: 22
    },
    "MS130-8-HW": {
      list: 920,
      price: 534,
      discount: 0.4196,
      zoho_product_id: "2570562000182445402",
      discount_per_unit: 386,
      discount_pct: 42
    },
    "MS130-8X-HW": {
      list: 2501,
      price: 1452,
      discount: 0.4194,
      zoho_product_id: "2570562000182445403",
      discount_per_unit: 1049,
      discount_pct: 42
    },
    "MS130-48X-HW": {
      list: 9428,
      price: 5474,
      discount: 0.4194,
      zoho_product_id: "2570562000182445404",
      discount_per_unit: 3954,
      discount_pct: 42
    },
    "MA-MNT-MR-8": {
      list: 58,
      price: 39,
      discount: 0.3276,
      zoho_product_id: "2570562000003355108",
      discount_per_unit: 19,
      discount_pct: 33
    },
    Z4CX: {
      list: 1346,
      price: 905,
      discount: 42,
      discount_per_unit: 441,
      discount_pct: 33
    },
    Z4X: {
      list: 779,
      price: 363,
      discount: 59,
      discount_per_unit: 416,
      discount_pct: 53
    },
    "MS130-12X-HW": {
      list: 3162,
      price: 1836,
      discount: 0.4194,
      zoho_product_id: "2570562000182445405",
      discount_per_unit: 1326,
      discount_pct: 42
    },
    "MS130-24-HW": {
      list: 2139,
      price: 1241,
      discount: 0.4198,
      zoho_product_id: "2570562000182445407",
      discount_per_unit: 898,
      discount_pct: 42
    },
    "MS130-48-HW": {
      list: 3794,
      price: 2203,
      discount: 0.4193,
      zoho_product_id: "2570562000182445409",
      discount_per_unit: 1591,
      discount_pct: 42
    },
    "MR28-HW": {
      list: 610,
      price: 320,
      discount: 0.4754,
      zoho_product_id: "2570562000122475094",
      discount_per_unit: 290,
      discount_pct: 48
    },
    "MA-SFP-1GB-SX": {
      list: 612,
      price: 411,
      discount: 0.3284,
      zoho_product_id: "2570562000000159968",
      discount_per_unit: 201,
      discount_pct: 33
    },
    "MG21E-HW-NA": {
      list: 1248,
      price: 839,
      discount: 42,
      zoho_product_id: "2570562000025231454",
      discount_per_unit: 409,
      discount_pct: 33
    },
    "MA-ANT-C1-B": {
      list: 605,
      price: 408,
      discount: 0.3256,
      zoho_product_id: "2570562000028848052",
      discount_per_unit: 197,
      discount_pct: 33
    },
    "C9300X-24HX-M": {
      list: 17923,
      price: 10315,
      discount: 0.4245,
      zoho_product_id: "2570562000236760162",
      discount_per_unit: 7608,
      discount_pct: 42
    },
    "MA-CBL-SPWR-30CM": {
      list: 135,
      price: 91,
      discount: 0.3259,
      zoho_product_id: "2570562000025231495",
      discount_per_unit: 44,
      discount_pct: 33
    },
    "MA-MOD-2X40G": {
      list: 3119,
      price: 2098,
      discount: 0.3273,
      zoho_product_id: "2570562000025231496",
      discount_per_unit: 1021,
      discount_pct: 33
    },
    "MA-PWR-1100WAC": {
      list: 2409,
      price: 1621,
      discount: 0.3271,
      zoho_product_id: "2570562000025231490",
      discount_per_unit: 788,
      discount_pct: 33
    },
    "MS390-24UX-HW": {
      list: 14896,
      price: 6210,
      discount: 0.5831,
      zoho_product_id: "2570562000025231484",
      discount_per_unit: 8686,
      discount_pct: 58
    },
    "MA-CBL-120G-50CM": {
      list: 153,
      price: 103,
      discount: 0.3268,
      zoho_product_id: "2570562000025231501",
      discount_per_unit: 50,
      discount_pct: 33
    },
    "MS390-48UX2-HW": {
      list: 14310,
      price: 5966,
      discount: 0.5831,
      zoho_product_id: "2570562000025231481",
      discount_per_unit: 8344,
      discount_pct: 58
    },
    "CW-ACC-KIT1-00": {
      list: 156,
      price: 106,
      discount: 0.3205,
      zoho_product_id: "2570562000253239869",
      discount_per_unit: 50,
      discount_pct: 32
    },
    "MA-CBL-TA-1M": {
      list: 134,
      price: 91,
      discount: 0.3209,
      zoho_product_id: "2570562000000161174",
      discount_per_unit: 43,
      discount_pct: 32
    },
    "MS225-48-HW": {
      list: 7081,
      price: 2971,
      discount: 0.5804,
      zoho_product_id: "2570562000000157380",
      discount_per_unit: 4110,
      discount_pct: 58
    },
    "MS250-48FP-HW": {
      list: 14830,
      price: 6153,
      discount: 0.5851,
      zoho_product_id: "2570562000000157387",
      discount_per_unit: 8677,
      discount_pct: 59
    },
    "MA-SFP-10GB-LR": {
      list: 4886,
      price: 3286,
      discount: 0.3275,
      zoho_product_id: "2570562000000159964",
      discount_per_unit: 1600,
      discount_pct: 33
    },
    "MA-CBL-TEMP-GL-1": {
      list: 78,
      price: 53,
      discount: 0.3205,
      zoho_product_id: "2570562000065238618",
      discount_per_unit: 25,
      discount_pct: 32
    },
    "MA-ACC-MGKIT-1": {
      list: 208,
      price: 136,
      discount: 0.3462,
      zoho_product_id: "2570562000261763057",
      discount_per_unit: 72,
      discount_pct: 35
    },
    "MA-ANT-DUAL-C3": {
      list: 1039,
      price: 676,
      discount: 0.3494,
      zoho_product_id: "2570562000261763058",
      discount_per_unit: 363,
      discount_pct: 35
    },
    "MA-KIT-MV-2A": {
      list: 311,
      price: 202,
      discount: 0.3505,
      zoho_product_id: "2570562000261763059",
      discount_per_unit: 109,
      discount_pct: 35
    },
    "MA-PWR-150WAC-ADP": {
      list: 415,
      price: 270,
      discount: 0.3494,
      zoho_product_id: "2570562000261763060",
      discount_per_unit: 145,
      discount_pct: 35
    },
    "C9300-NM-2Y-M": {
      list: 3132,
      price: 2107,
      discount: 0.3273,
      zoho_product_id: "2570562000212143564",
      discount_per_unit: 1025,
      discount_pct: 33
    },
    "MS225-48FP-HW": {
      list: 9619,
      price: 3594,
      discount: 0.6264,
      zoho_product_id: "2570562000000157382",
      discount_per_unit: 6025,
      discount_pct: 63
    },
    "MA-CBL-100G-1M": {
      list: 269,
      price: 182,
      discount: 0.3234,
      zoho_product_id: "2570562000012504192",
      discount_per_unit: 87,
      discount_pct: 32
    },
    "MA-ANT-25": {
      list: 427,
      price: 287,
      discount: 0.3279,
      zoho_product_id: "2570562000000161214",
      discount_per_unit: 140,
      discount_pct: 33
    },
    "MV63-HW": {
      list: 1488,
      price: 762,
      discount: 0.4879,
      zoho_product_id: "2570562000122474053",
      discount_per_unit: 726,
      discount_pct: 49
    },
    "MA-ANT-27": {
      list: 427,
      price: 287,
      discount: 0.3279,
      zoho_product_id: "2570562000000161215",
      discount_per_unit: 140,
      discount_pct: 33
    },
    "MA-ANT-23": {
      list: 427,
      price: 287,
      discount: 0.3279,
      zoho_product_id: "2570562000000161213",
      discount_per_unit: 140,
      discount_pct: 33
    },
    "MA-ANT-20": {
      list: 243,
      price: 164,
      discount: 0.3251,
      zoho_product_id: "2570562000000161211",
      discount_per_unit: 79,
      discount_pct: 33
    },
    "MA-ANT-21": {
      list: 427,
      price: 287,
      discount: 0.3279,
      zoho_product_id: "2570562000000161212",
      discount_per_unit: 140,
      discount_pct: 33
    },
    "MS150-24MP-4X": {
      list: 10864,
      price: 4059,
      discount: 0.6264,
      zoho_product_id: "2570562000288625099",
      discount_per_unit: 6805,
      discount_pct: 63
    },
    "MA-PWR-ETH": {
      list: 182,
      price: 123,
      discount: 0.3242,
      zoho_product_id: "2570562000080039876",
      discount_per_unit: 59,
      discount_pct: 32
    },
    "C9300L-24T-4X-M": {
      list: 7994,
      price: 3078,
      discount: 0.615,
      zoho_product_id: "2570562000224134827",
      discount_per_unit: 4916,
      discount_pct: 61
    },
    "MA-MNT-MV-78": {
      list: 467,
      price: 314,
      discount: 0.3276,
      zoho_product_id: "2570562000125564917",
      discount_per_unit: 153,
      discount_pct: 33
    },
    "MS390-48UX-HW": {
      list: 14833,
      price: 6184,
      discount: 0.5831,
      zoho_product_id: "2570562000025231483",
      discount_per_unit: 8649,
      discount_pct: 58
    },
    "MV93X-HW": {
      list: 3321,
      price: 1699,
      discount: 0.4884,
      zoho_product_id: "2570562000125794162",
      discount_per_unit: 1622,
      discount_pct: 49
    },
    "MA-CBL-120G-1M": {
      list: 306,
      price: 206,
      discount: 0.3268,
      zoho_product_id: "2570562000025231500",
      discount_per_unit: 100,
      discount_pct: 33
    },
    "MA-MOD-8X10G": {
      list: 3235,
      price: 2176,
      discount: 0.3274,
      zoho_product_id: "2570562000025231494",
      discount_per_unit: 1059,
      discount_pct: 33
    },
    "Z4C-HW": {
      list: 1398,
      price: 940,
      discount: 0.3276,
      zoho_product_id: "2570562000198467609",
      discount_per_unit: 458,
      discount_pct: 33
    },
    "CW9171I-RTG": {
      list: 918,
      price: 480,
      discount: 0.4771,
      zoho_product_id: "2570562000375727016",
      discount_per_unit: 438,
      discount_pct: 48
    },
    "CW9172I-RTG": {
      list: 1677,
      price: 820,
      discount: 0.511,
      zoho_product_id: "2570562000297110189",
      discount_per_unit: 857,
      discount_pct: 51
    },
    "CW9174I-RTG": {
      list: 2523,
      price: 1175,
      discount: 0.5343,
      zoho_product_id: "2570562000364457647",
      discount_per_unit: 1348,
      discount_pct: 53
    },
    "CW9176I-RTG": {
      list: 3246,
      price: 1437,
      discount: 0.5573,
      zoho_product_id: "2570562000275210200",
      discount_per_unit: 1809,
      discount_pct: 56
    },
    "CW9176D1-RTG": {
      list: 3636,
      price: 1609,
      discount: 0.5575,
      zoho_product_id: "2570562000281459062",
      discount_per_unit: 2027,
      discount_pct: 56
    },
    "CW9178I-RTG": {
      list: 3896,
      price: 2038,
      discount: 0.4769,
      zoho_product_id: "2570562000275767025",
      discount_per_unit: 1858,
      discount_pct: 48
    },
    CW9179F: {
      list: 9756,
      price: 6561,
      discount: 0.3275,
      zoho_product_id: "2570562000350232263",
      discount_per_unit: 3195,
      discount_pct: 33
    },
    "C8111-G2-MX": {
      list: 1256,
      price: 845,
      discount: 0.3272,
      zoho_product_id: "2570562000384052111",
      discount_per_unit: 411,
      discount_pct: 33
    },
    "LIC-C8111-ENT-1Y": {
      list: 558,
      price: 376,
      discount: 0.3262,
      zoho_product_id: "2570562000385878069",
      discount_per_unit: 182,
      discount_pct: 33
    },
    "LIC-C8111-ENT-3Y": {
      list: 1256,
      price: 845,
      discount: 0.3272,
      zoho_product_id: "2570562000385878070",
      discount_per_unit: 411,
      discount_pct: 33
    },
    "LIC-C8111-ENT-5Y": {
      list: 2094,
      price: 1408,
      discount: 0.3276,
      zoho_product_id: "2570562000385878071",
      discount_per_unit: 686,
      discount_pct: 33
    },
    "LIC-C8111-SEC-1Y": {
      list: 1117,
      price: 752,
      discount: 0.3268,
      zoho_product_id: "2570562000384071049",
      discount_per_unit: 365,
      discount_pct: 33
    },
    "LIC-C8111-SEC-3Y": {
      list: 2513,
      price: 1690,
      discount: 0.3275,
      zoho_product_id: "2570562000385878079",
      discount_per_unit: 823,
      discount_pct: 33
    },
    "LIC-C8111-SEC-5Y": {
      list: 4188,
      price: 2816,
      discount: 0.3276,
      zoho_product_id: "2570562000385878080",
      discount_per_unit: 1372,
      discount_pct: 33
    },
    "LIC-C8111-SDW-1Y": {
      list: 1675,
      price: 1126,
      discount: 0.3278,
      zoho_product_id: "2570562000385878074",
      discount_per_unit: 549,
      discount_pct: 33
    },
    "LIC-C8111-SDW-3Y": {
      list: 3769,
      price: 2534,
      discount: 0.3277,
      zoho_product_id: "2570562000385878075",
      discount_per_unit: 1235,
      discount_pct: 33
    },
    "LIC-C8111-SDW-5Y": {
      list: 6281,
      price: 4224,
      discount: 0.3275,
      zoho_product_id: "2570562000385878076",
      discount_per_unit: 2057,
      discount_pct: 33
    },
    "C8121-G2-MX": {
      list: 2069,
      price: 1386,
      discount: 0.3301,
      zoho_product_id: "2570562000403908520",
      discount_per_unit: 683,
      discount_pct: 33
    },
    "LIC-C8121-SEC-1Y": {
      list: 1839,
      price: 1232,
      discount: 0.3301,
      zoho_product_id: "2570562000403908498",
      discount_per_unit: 607,
      discount_pct: 33
    },
    "LIC-C8121-SEC-3Y": {
      list: 4136,
      price: 2771,
      discount: 0.33,
      zoho_product_id: "2570562000403908497",
      discount_per_unit: 1365,
      discount_pct: 33
    },
    "LIC-C8121-SEC-5Y": {
      list: 6893,
      price: 4618,
      discount: 0.33,
      zoho_product_id: "2570562000403909424",
      discount_per_unit: 2275,
      discount_pct: 33
    },
    "LIC-C8121-SDW-1Y": {
      list: 2757,
      price: 1847,
      discount: 0.3301,
      zoho_product_id: "2570562000403908503",
      discount_per_unit: 910,
      discount_pct: 33
    },
    "LIC-C8121-SDW-3Y": {
      list: 6203,
      price: 4156,
      discount: 0.33,
      zoho_product_id: "2570562000403908502",
      discount_per_unit: 2047,
      discount_pct: 33
    },
    "LIC-C8121-SDW-5Y": {
      list: 10340,
      price: 6928,
      discount: 0.33,
      zoho_product_id: "2570562000403908501",
      discount_per_unit: 3412,
      discount_pct: 33
    },
    "LIC-C8121-ENT-1Y": {
      list: 919,
      price: 616,
      discount: 0.3297,
      zoho_product_id: "2570562000403908508",
      discount_per_unit: 303,
      discount_pct: 33
    },
    "LIC-C8121-ENT-3Y": {
      list: 2069,
      price: 1386,
      discount: 0.3301,
      zoho_product_id: "2570562000403908507",
      discount_per_unit: 683,
      discount_pct: 33
    },
    "LIC-C8121-ENT-5Y": {
      list: 3446,
      price: 2309,
      discount: 0.3299,
      zoho_product_id: "2570562000403908506",
      discount_per_unit: 1137,
      discount_pct: 33
    },
    "C8455-G2-MX": {
      list: 44451,
      price: 29890,
      discount: 0.3276,
      zoho_product_id: "2570562000362899273",
      discount_per_unit: 14561,
      discount_pct: 33
    },
    "LIC-C8455-SEC-1Y": {
      list: 18380,
      price: 12360,
      discount: 0.3275,
      zoho_product_id: "2570562000385878056",
      discount_per_unit: 6020,
      discount_pct: 33
    },
    "LIC-C8455-SEC-3Y": {
      list: 41357,
      price: 27809,
      discount: 0.3276,
      zoho_product_id: "2570562000385878065",
      discount_per_unit: 13548,
      discount_pct: 33
    },
    "LIC-C8455-SEC-5Y": {
      list: 68927,
      price: 46348,
      discount: 0.3276,
      zoho_product_id: "2570562000385878066",
      discount_per_unit: 22579,
      discount_pct: 33
    },
    "LIC-C8455-SDW-1Y": {
      list: 26753,
      price: 17990,
      discount: 0.3276,
      zoho_product_id: "2570562000385878060",
      discount_per_unit: 8763,
      discount_pct: 33
    },
    "LIC-C8455-SDW-3Y": {
      list: 60179,
      price: 40466,
      discount: 0.3276,
      zoho_product_id: "2570562000385878061",
      discount_per_unit: 19713,
      discount_pct: 33
    },
    "LIC-C8455-SDW-5Y": {
      list: 100299,
      price: 67443,
      discount: 0.3276,
      zoho_product_id: "2570562000385878062",
      discount_per_unit: 32856,
      discount_pct: 33
    },
    "LIC-UMB-DNS-ESS-K9-1YR": {
      list: 62.1,
      price: 49,
      discount: 13.1,
      zoho_product_id: "2570562000340122857",
      discount_per_unit: 13.1,
      discount_pct: 21
    },
    "LIC-UMB-DNS-ESS-K9-3YR": {
      list: 186.3,
      price: 146,
      discount: 40.3,
      zoho_product_id: "2570562000340122891",
      discount_per_unit: 40.3,
      discount_pct: 22
    },
    "LIC-UMB-DNS-ESS-K9-5YR": {
      list: 310.5,
      price: 243,
      discount: 67.5,
      zoho_product_id: "2570562000340122924",
      discount_per_unit: 67.5,
      discount_pct: 22
    },
    "LIC-UMB-DNS-ADV-K9-1YR": {
      list: 93.15,
      price: 74,
      discount: 19.15,
      zoho_product_id: "2570562000342392023",
      discount_per_unit: 19.15,
      discount_pct: 21
    },
    "LIC-UMB-DNS-ADV-K9-3YR": {
      list: 279.45,
      price: 217,
      discount: 62.45,
      zoho_product_id: "2570562000342392057",
      discount_per_unit: 62.45,
      discount_pct: 22
    },
    "LIC-UMB-DNS-ADV-K9-5YR": {
      list: 465.75,
      price: 364,
      discount: 101.75,
      zoho_product_id: "2570562000342392090",
      discount_per_unit: 101.75,
      discount_pct: 22
    },
    "LIC-UMB-SIG-ESS-K9-1YR": {
      list: 129.6,
      price: 101,
      discount: 28.6,
      zoho_product_id: "2570562000342865075",
      discount_per_unit: 28.6,
      discount_pct: 22
    },
    "LIC-UMB-SIG-ESS-K9-3YR": {
      list: 388.8,
      price: 303,
      discount: 85.8,
      zoho_product_id: "2570562000342865114",
      discount_per_unit: 85.8,
      discount_pct: 22
    },
    "LIC-UMB-SIG-ESS-K9-5YR": {
      list: 648,
      price: 506,
      discount: 142,
      zoho_product_id: "2570562000342865147",
      discount_per_unit: 142,
      discount_pct: 22
    },
    "LIC-UMB-SIG-ADV-K9-1YR": {
      list: 198.96,
      price: 155,
      discount: 43.96,
      zoho_product_id: "2570562000342865227",
      discount_per_unit: 43.96,
      discount_pct: 22
    },
    "LIC-UMB-SIG-ADV-K9-3YR": {
      list: 596.88,
      price: 466,
      discount: 130.88,
      zoho_product_id: "2570562000342865261",
      discount_per_unit: 130.88,
      discount_pct: 22
    },
    "LIC-UMB-SIG-ADV-K9-5YR": {
      list: 994.8,
      price: 776,
      discount: 218.8,
      zoho_product_id: "2570562000342865294",
      discount_per_unit: 218.8,
      discount_pct: 22
    },
    "LIC-DUO-ESSENTIALS-1YR": {
      list: 36,
      price: 34,
      discount: 2,
      zoho_product_id: "2570562000161188676",
      discount_per_unit: 2,
      discount_pct: 6
    },
    "LIC-DUO-ESSENTIALS-3YR": {
      list: 108,
      price: 101,
      discount: 7,
      zoho_product_id: "2570562000161188677",
      discount_per_unit: 7,
      discount_pct: 6
    },
    "LIC-DUO-ESSENTIALS-5YR": {
      list: 180,
      price: 168,
      discount: 12,
      zoho_product_id: "2570562000161188678",
      discount_per_unit: 12,
      discount_pct: 7
    },
    "LIC-DUO-ADVANTAGE-1YR": {
      list: 72,
      price: 68,
      discount: 4,
      zoho_product_id: "2570562000161188670",
      discount_per_unit: 4,
      discount_pct: 6
    },
    "LIC-DUO-ADVANTAGE-3YR": {
      list: 216,
      price: 201,
      discount: 15,
      zoho_product_id: "2570562000161188671",
      discount_per_unit: 15,
      discount_pct: 7
    },
    "LIC-DUO-ADVANTAGE-5YR": {
      list: 360,
      price: 336,
      discount: 24,
      zoho_product_id: "2570562000161188672",
      discount_per_unit: 24,
      discount_pct: 7
    },
    "LIC-DUO-PREMIER-1YR": {
      list: 108,
      price: 101,
      discount: 7,
      zoho_product_id: "2570562000161188673",
      discount_per_unit: 7,
      discount_pct: 6
    },
    "LIC-DUO-PREMIER-3YR": {
      list: 324,
      price: 302,
      discount: 22,
      zoho_product_id: "2570562000161188674",
      discount_per_unit: 22,
      discount_pct: 7
    },
    "LIC-DUO-PREMIER-5YR": {
      list: 540,
      price: 503,
      discount: 37,
      zoho_product_id: "2570562000161188675",
      discount_per_unit: 37,
      discount_pct: 7
    },
    "AIR-AP-BRACKET-1=": {
      list: 26,
      price: 18,
      discount: 0.3077,
      zoho_product_id: "2570562000302551438",
      discount_per_unit: 8,
      discount_pct: 31
    },
    "AIR-AP-BRACKET-2=": {
      list: 26,
      price: 18,
      discount: 0.3077,
      zoho_product_id: "2570562000281509088",
      discount_per_unit: 8,
      discount_pct: 31
    },
    "MA-INJ-4": {
      list: 150,
      price: 107,
      discount: 0.2867,
      zoho_product_id: "2570562000090052297",
      discount_per_unit: 43,
      discount_pct: 29
    },
    "MA-INJ-6": {
      list: 375,
      price: 313,
      discount: 0.1653,
      zoho_product_id: "2570562000065238620",
      discount_per_unit: 62,
      discount_pct: 17
    },
    "MA-PWR-300W-INDADP": {
      list: 830,
      price: 559,
      discount: 0.3265,
      zoho_product_id: "2570562000221103136",
      discount_per_unit: 271,
      discount_pct: 33
    },
    "MA-PWR-CORD-TW": {
      list: 15,
      price: 20,
      discount: -0.3333,
      zoho_product_id: "2570562000154200068",
      discount_per_unit: -5,
      discount_pct: -33
    },
    "MA-SIMTRAY-2C": {
      list: 21,
      price: 15,
      discount: 0.2857,
      zoho_product_id: "2570562000282151123",
      discount_per_unit: 6,
      discount_pct: 29
    },
    "MA-SIMTRAY-5C": {
      list: 31,
      price: 22,
      discount: 0.2903,
      zoho_product_id: "2570562000282151124",
      discount_per_unit: 9,
      discount_pct: 29
    },
    MV2: {
      list: 519,
      price: 266,
      discount: 0.4875,
      zoho_product_id: "2570562000062657390",
      discount_per_unit: 253,
      discount_pct: 49
    },
    MX67: {
      list: 567,
      price: 397,
      discount: 0.3,
      zoho_product_id: "2570562000009234263",
      discount_per_unit: 170,
      discount_pct: 30
    },
    MX68: {
      list: 810,
      price: 567,
      discount: 0.3,
      zoho_product_id: "2570562000010523428",
      discount_per_unit: 243,
      discount_pct: 30
    },
    "LIC-L-AC-APX-1Y-S1": {
      list: 15,
      price: 15,
      discount: 42,
      zoho_product_id: "2570562000030344805",
      discount_per_unit: 0,
      discount_pct: 3
    },
    "LIC-L-AC-APX-3Y-S1": {
      list: 34,
      price: 34,
      discount: 39,
      zoho_product_id: "2570562000076283685",
      discount_per_unit: 0,
      discount_pct: 1
    },
    "LIC-L-AC-APX-5Y-S1": {
      list: 43,
      price: 43,
      discount: 42,
      zoho_product_id: "2570562000117689945",
      discount_per_unit: 0,
      discount_pct: 0
    },
    "LIC-L-AC-PLS-1Y-S1": {
      list: 6,
      price: 6,
      discount: 22,
      zoho_product_id: "2570562000012866813",
      discount_per_unit: 0,
      discount_pct: 7
    },
    "LIC-L-AC-PLS-3Y-S1": {
      list: 15,
      price: 15,
      discount: 42,
      zoho_product_id: "2570562000019014661",
      discount_per_unit: 0,
      discount_pct: 3
    },
    "LIC-L-AC-PLS-5Y-S1": {
      list: 23,
      price: 22,
      discount: 38,
      zoho_product_id: "2570562000152273117",
      discount_per_unit: 1,
      discount_pct: 3
    },
    "LIC-MI-EMSC-D-1YMC-A-1YR": {
      list: 24,
      price: 24,
      discount: 0,
      zoho_product_id: "2570562000414875794",
      discount_per_unit: 0,
      discount_pct: 0
    },
    "LIC-MI-EMSC-D-1YMC-A-3YR": {
      list: 72,
      price: 72,
      discount: 0,
      zoho_product_id: "2570562000414875795",
      discount_per_unit: 0,
      discount_pct: 0
    },
    "LIC-MI-EMSC-D-1YMC-A-5YR": {
      list: 120,
      price: 120,
      discount: 0,
      zoho_product_id: "2570562000414875796",
      discount_per_unit: 0,
      discount_pct: 0
    }
  },
  _meta: {
    source: "Meraki Price Book Mar 14, 2026",
    last_updated: "2026-03-14",
    total_skus: 985,
    structure: "list=MSRP, price=ecomm price, discount=percent off",
    note: "Use 'price' field directly - no calculation needed. Duplicate base SKUs removed where -HW version exists.",
    new_products_pending_review: 64
  },
  _new_products_flagged: [
    {
      sku: "LIC-SME-5YR",
      description: "Cisco Meraki Systems Manager Enterprise Device License, 5YR",
      type: "SW",
      list_price: 120
    },
    {
      sku: "MA-PWR-CORD-US-$0",
      description: "Configured Meraki AC Power Cord for MX and MS (US Plug)",
      type: "HW",
      list_price: 0
    },
    {
      sku: "MV12W",
      description: "Meraki Wide Angle MV12 Mini Dome HD Camera - 256GB Storage",
      type: "HW",
      list_price: 934
    },
    {
      sku: "MV12WE",
      description: "Meraki Wide Angle MV12 Mini Dome HD Camera - 128GB Storage",
      type: "HW",
      list_price: 830
    },
    {
      sku: "MV13",
      description: "Meraki Indoor fixed lens mini dome camera w/256GB storage",
      type: "HW",
      list_price: 1038
    },
    {
      sku: "MV13M",
      description: "Meraki Indoor fixed lens mini dome camera w/512GB storage",
      type: "HW",
      list_price: 1350
    },
    {
      sku: "MV2",
      description: "Meraki MV2 Indoor Flex Camera (Power Adapter not included)",
      type: "HW",
      list_price: 519
    },
    {
      sku: "MV22",
      description: "Meraki Varifocal MV22 Indoor HD Dome Camera - 256GB Storage",
      type: "HW",
      list_price: 1350
    },
    {
      sku: "MV22X",
      description: "Meraki Varifocal MV22 Indoor HD Dome Camera - 512GB Storage",
      type: "HW",
      list_price: 1558
    },
    {
      sku: "MV23M",
      description: "Meraki Varifocal Lens MV23 Dome, 8MP Indoor Camera- 512GB",
      type: "HW",
      list_price: 1973
    },
    {
      sku: "MV23X",
      description: "Meraki Varifocal Lens MV23 Dome, 8MP Indoor Camera- 1TB",
      type: "HW",
      list_price: 2493
    },
    {
      sku: "MG41",
      description: "Meraki MG41 Cellular Gateway",
      type: "HW",
      list_price: 1584
    },
    {
      sku: "MG51E",
      description: "Meraki MG51E Cellular Gateway External Antennas",
      type: "HW",
      list_price: 2125
    },
    {
      sku: "MG52",
      description: "Meraki MG52 Base",
      type: "HW",
      list_price: 2026
    },
    {
      sku: "MG52E",
      description: "Meraki MG52E Base",
      type: "HW",
      list_price: 2234
    },
    {
      sku: "MV12N",
      description: "Meraki Narrow Angle MV12 Mini Dome HD Camera - 256GB Storage",
      type: "HW",
      list_price: 934
    },
    {
      sku: "MV33",
      description: "Meraki Indoor 360 degree Fisheye camera w/ 256GB storage",
      type: "HW",
      list_price: 1246
    },
    {
      sku: "MV33M",
      description: "Meraki Indoor 360 degree Fisheye camera w/ 512GB storage",
      type: "HW",
      list_price: 1662
    },
    {
      sku: "MV52",
      description: "Meraki Varifocal MV52 Outdoor Bullet Camera With 1TB Storage",
      type: "HW",
      list_price: 3428
    },
    {
      sku: "MV63",
      description: "Meraki Fixed Lens MV63 Mini-dome, Outdoor 4MP Camera- 256GB",
      type: "HW",
      list_price: 1350
    },
    {
      sku: "MV63M",
      description: "Meraki Fixed Lens Mini-dome, Outdoor 4MP Camera- 512GB",
      type: "HW",
      list_price: 1662
    },
    {
      sku: "MV63X",
      description: "Meraki Fixed Lens MV63X Mini-dome, Outdoor 4K Camera- 1TB",
      type: "HW",
      list_price: 2597
    },
    {
      sku: "MV73M",
      description: "Meraki Varifocal Lens MV73 Dome, 8MP Outdoor Camera- 512GB",
      type: "HW",
      list_price: 2285
    },
    {
      sku: "MX85",
      description: "Meraki MX85 Router/Security Appliance",
      type: "SW",
      list_price: 3052
    },
    {
      sku: "CW9176D1-RTG",
      description: "CiscWireles9176D1(W7,3radio3band4x4UWB)Global REMANUFACTURED",
      type: "HW",
      list_price: 2247
    },
    {
      sku: "CW9176I-RTG",
      description: "CisoWireles9176I(W7,3radio3band4x4,UWB)Global REMANUFACTURED",
      type: "HW",
      list_price: 2006
    },
    {
      sku: "CW9178I-RTG",
      description: "CiscoWireless9178I(W7,4radio3band4x4UWB)Globl REMANUFACTURED",
      type: "HW",
      list_price: 2408
    },
    {
      sku: "MV73X",
      description: "Meraki Varifocal Lens MV73X Dome, 8MP Outdoor Camera- 1TB",
      type: "HW",
      list_price: 2909
    },
    {
      sku: "MV93",
      description: "Meraki 360-degree MV93, Outdoor Rated Fish Eye Camera- 256GB",
      type: "HW",
      list_price: 1662
    },
    {
      sku: "MV93M",
      description: "Meraki 360-degree MV93, Outdoor rated fish eye camera- 512GB",
      type: "HW",
      list_price: 2077
    },
    {
      sku: "MV93X",
      description: "Meraki 360-degree MV93, Outdoor Rated Fish Eye Camera- 1TB",
      type: "HW",
      list_price: 3013
    },
    {
      sku: "MS130-48X",
      description: "Meraki MS130-48X Cloud Mgd. 40GE + 8x(2.5GE) 740W PoE Switch",
      type: "HW",
      list_price: 9428
    },
    {
      sku: "CW9172I-RTG",
      description: "Cisco Wireless 9172I(W7,3 radio,3 band 2x2),Global",
      type: "HW",
      list_price: 1677
    },
    {
      sku: "MG41E",
      description: "Meraki MG41 Cellular Gateway External Antennas",
      type: "SW",
      list_price: 1706
    },
    {
      sku: "MX68W",
      description: "Meraki MX68W Router/Security Appliance with 802.11ac",
      type: "HW",
      list_price: 1712
    },
    {
      sku: "MS130R-8P",
      description: "Meraki MS130R-8P Cloud Mgd Ruggedized 8GE 240W PoE Switch",
      type: "HW",
      list_price: 4023
    },
    {
      sku: "MT10",
      description: "Meraki MT10 Indoor Temperature and Humidity Sensor",
      type: "HW",
      list_price: 156
    },
    {
      sku: "MT11",
      description: "Meraki Probe Sensor",
      type: "HW",
      list_price: 156
    },
    {
      sku: "MT12",
      description: "Meraki MT12 Indoor Water Leak Sensor",
      type: "HW",
      list_price: 156
    },
    {
      sku: "MT14",
      description: "Meraki MT14 Indoor Air Quality Sensor",
      type: "HW",
      list_price: 260
    },
    {
      sku: "MT15",
      description: "Meraki MT15 Indoor Air Quality with CO2 Sensor",
      type: "HW",
      list_price: 520
    },
    {
      sku: "MT20",
      description: "Meraki MT20 Indoor Door Open/Close Sensor",
      type: "HW",
      list_price: 156
    },
    {
      sku: "MT30",
      description: "Meraki MT30 Smart Automation Button",
      type: "HW",
      list_price: 156
    },
    {
      sku: "MT40",
      description: "Meraki MT40 Smart Power Monitor and Switch",
      type: "HW",
      list_price: 260
    },
    {
      sku: "MX105",
      description: "Meraki MX105 Router/Security Appliance",
      type: "HW",
      list_price: 9167
    },
    {
      sku: "MS130-12X",
      description: "Meraki MS130-12X Cloud Mgd. 8GE + 4x(2.5GE) 240W PoE Switch",
      type: "HW",
      list_price: 3162
    },
    {
      sku: "MX250",
      description: "Meraki MX250 Router/Security Appliance",
      type: "HW",
      list_price: 13570
    },
    {
      sku: "MX450",
      description: "Meraki MX450 Router/Security Appliance",
      type: "HW",
      list_price: 27147
    },
    {
      sku: "MX67",
      description: "Meraki MX67 Router/Security Appliance",
      type: "HW",
      list_price: 850
    },
    {
      sku: "MX67C-WW",
      description: "Meraki MX67C LTE Router/Security Appliance - Worldwide",
      type: "HW",
      list_price: 1712
    },
    {
      sku: "MX67W",
      description: "Meraki MX67W Router/Security Appliance with 802.11ac",
      type: "HW",
      list_price: 1315
    },
    {
      sku: "MX68",
      description: "Meraki MX68 Router/Security Appliance",
      type: "HW",
      list_price: 1217
    },
    {
      sku: "MX68CW-WW",
      description: "Meraki MX68CW LTE & 802.11ac Router/Security Appliance - WW",
      type: "HW",
      list_price: 2373
    },
    {
      sku: "MS130-24",
      description: "Meraki MS130-24 Cloud Managed 24GE Switch",
      type: "HW",
      list_price: 2139
    },
    {
      sku: "MS130-24P",
      description: "Meraki MS130-24P Cloud Managed 24GE 370W PoE Switch",
      type: "HW",
      list_price: 3443
    },
    {
      sku: "MS130-24X",
      description: "Meraki MS130-24X Cloud Mgd. 18GE + 6x(2.5GE) 370W PoE Switch",
      type: "HW",
      list_price: 6324
    },
    {
      sku: "MX95",
      description: "Meraki MX95 Router/Security Appliance",
      type: "HW",
      list_price: 6109
    },
    {
      sku: "MS130-48",
      description: "Meraki MS130-48 Cloud Managed 48GE Switch",
      type: "HW",
      list_price: 3794
    },
    {
      sku: "MS130-48P",
      description: "Meraki MS130-48P Cloud Managed 48GE 740W PoE Switch",
      type: "HW",
      list_price: 6151
    },
    {
      sku: "MS130-8",
      description: "Meraki MS130-8 Cloud Managed 8GE Switch",
      type: "HW",
      list_price: 920
    },
    {
      sku: "MS130-8P",
      description: "Meraki MS130-8P Cloud Managed 8GE 120W PoE Switch",
      type: "HW",
      list_price: 1581
    },
    {
      sku: "MS130-8P-I",
      description: "Meraki MS130-8P-I Cloud Mgd 8GE 120W PoE Switch Internal PSU",
      type: "HW",
      list_price: 1581
    },
    {
      sku: "MS130-8X",
      description: "Meraki MS130-8X Cloud Mgd. 6GE + 2x(2.5GE) 120W PoE Switch",
      type: "HW",
      list_price: 2501
    },
    {
      sku: "MX75",
      description: "Meraki MX75 Router/Security Appliance",
      type: "HW",
      list_price: 1964
    }
  ]
};

// src/data/auto-catalog.json
var auto_catalog_default = {
  _generated: "2026-03-23T19:59:02.000Z",
  _source: "prices.json",
  _description: "Auto-generated valid SKU catalog. Do not edit manually \u2014 run build-catalog.js instead.",
  _EOL_PRODUCTS: {
    MR: [
      "12",
      "16",
      "18",
      "20",
      "24",
      "26",
      "32",
      "33",
      "34",
      "42",
      "45",
      "52",
      "53",
      "55",
      "56",
      "62",
      "66",
      "70",
      "72",
      "74",
      "84",
      "30H",
      "42E",
      "53E"
    ],
    MX: [
      "60",
      "60W",
      "64",
      "64W",
      "65",
      "65W",
      "80",
      "84",
      "100",
      "400",
      "600"
    ],
    MV: [
      "12N",
      "12W",
      "12WE",
      "21",
      "22",
      "22X",
      "32",
      "52",
      "71",
      "72",
      "72X"
    ],
    MG: [
      "21",
      "21E",
      "51",
      "51E"
    ],
    Z: [
      "1",
      "3",
      "3C"
    ],
    MS120: [
      "8",
      "8LP",
      "8FP",
      "24",
      "24P",
      "48",
      "48LP",
      "48FP"
    ],
    MS125: [
      "24",
      "24P",
      "48",
      "48LP",
      "48FP"
    ],
    MS210: [
      "24",
      "24P",
      "48",
      "48LP",
      "48FP"
    ],
    MS220: [
      "8",
      "8P",
      "24",
      "24P",
      "48",
      "48LP",
      "48FP"
    ],
    MS225: [
      "24",
      "24P",
      "48",
      "48LP",
      "48FP"
    ],
    MS250: [
      "24",
      "24P",
      "48",
      "48LP",
      "48FP"
    ],
    MS320: [
      "24",
      "24P",
      "48",
      "48LP",
      "48FP"
    ],
    MS350: [
      "24",
      "24P",
      "24X",
      "48",
      "48LP",
      "48FP"
    ],
    MS355: [
      "24X",
      "24X2",
      "48X",
      "48X2"
    ],
    MS410: [
      "16",
      "32"
    ],
    MS420: [
      "24",
      "48"
    ],
    MS425: [
      "16",
      "32"
    ],
    MS390: [
      "24",
      "24P",
      "24U",
      "24UX",
      "48",
      "48P",
      "48U",
      "48UX",
      "48UX2"
    ]
  },
  _EOL_DATES: {
    "MS120-8": {
      eos: "2025-03-28",
      eost: "2030-03-28"
    },
    "MS120-8LP": {
      eos: "2025-03-28",
      eost: "2030-03-28"
    },
    "MS120-8FP": {
      eos: "2025-02-20",
      eost: "2030-03-28"
    },
    "MS120-24": {
      eos: "2025-03-28",
      eost: "2030-03-28"
    },
    "MS120-24P": {
      eos: "2025-03-28",
      eost: "2030-03-28"
    },
    "MS120-48": {
      eos: "2025-03-28",
      eost: "2030-03-28"
    },
    "MS120-48LP": {
      eos: "2025-03-28",
      eost: "2030-03-28"
    },
    "MS120-48FP": {
      eos: "2025-03-28",
      eost: "2030-03-28"
    },
    "MS125-24": {
      eos: "2025-03-28",
      eost: "2030-03-28"
    },
    "MS125-24P": {
      eos: "2025-03-28",
      eost: "2030-03-28"
    },
    "MS125-48": {
      eos: "2025-03-28",
      eost: "2030-03-28"
    },
    "MS125-48LP": {
      eos: "2025-03-28",
      eost: "2030-03-28"
    },
    "MS125-48FP": {
      eos: "2025-03-28",
      eost: "2030-03-28"
    },
    "MS210-24": {
      eos: "2026-04-30",
      eost: "2031-04-30"
    },
    "MS210-24P": {
      eos: "2026-04-30",
      eost: "2031-04-30"
    },
    "MS210-48": {
      eos: "2026-04-30",
      eost: "2031-04-30"
    },
    "MS210-48LP": {
      eos: "2026-04-30",
      eost: "2031-04-30"
    },
    "MS210-48FP": {
      eos: "2026-04-30",
      eost: "2031-04-30"
    },
    "MS220-8": {
      eos: "2018-09-21",
      eost: "2025-09-21"
    },
    "MS220-8P": {
      eos: "2018-09-21",
      eost: "2025-09-21"
    },
    "MS220-24": {
      eos: "2017-07-29",
      eost: "2024-07-29"
    },
    "MS220-24P": {
      eos: "2017-07-29",
      eost: "2024-07-29"
    },
    "MS220-48": {
      eos: "2017-07-29",
      eost: "2024-07-29"
    },
    "MS220-48LP": {
      eos: "2017-07-29",
      eost: "2024-07-29"
    },
    "MS220-48FP": {
      eos: "2017-07-29",
      eost: "2024-07-29"
    },
    "MS225-24": {
      eos: "2026-04-30",
      eost: "2031-04-30"
    },
    "MS225-24P": {
      eos: "2026-04-30",
      eost: "2031-04-30"
    },
    "MS225-48": {
      eos: "2026-04-30",
      eost: "2031-04-30"
    },
    "MS225-48LP": {
      eos: "2026-04-30",
      eost: "2031-04-30"
    },
    "MS225-48FP": {
      eos: "2026-04-30",
      eost: "2031-04-30"
    },
    "MS250-24": {
      eos: "2025-08-08",
      eost: "2030-08-08"
    },
    "MS250-24P": {
      eos: "2025-08-08",
      eost: "2030-08-08"
    },
    "MS250-48": {
      eos: "2025-08-08",
      eost: "2030-08-08"
    },
    "MS250-48LP": {
      eos: "2025-08-08",
      eost: "2030-08-08"
    },
    "MS250-48FP": {
      eos: "2025-08-08",
      eost: "2030-08-08"
    },
    "MS320-24": {
      eos: "2017-03-31",
      eost: "2024-03-31"
    },
    "MS320-24P": {
      eos: "2017-03-31",
      eost: "2024-03-31"
    },
    "MS320-48": {
      eos: "2017-03-31",
      eost: "2024-03-31"
    },
    "MS320-48LP": {
      eos: "2017-03-31",
      eost: "2024-03-31"
    },
    "MS320-48FP": {
      eos: "2017-03-31",
      eost: "2024-03-31"
    },
    "MS350-24": {
      eos: "2025-07-11",
      eost: "2030-08-08"
    },
    "MS350-24P": {
      eos: "2025-05-30",
      eost: "2030-08-08"
    },
    "MS350-24X": {
      eos: "2025-08-08",
      eost: "2030-08-08"
    },
    "MS350-48": {
      eos: "2025-08-08",
      eost: "2030-08-08"
    },
    "MS350-48LP": {
      eos: "2025-05-30",
      eost: "2030-08-08"
    },
    "MS350-48FP": {
      eos: "2025-07-22",
      eost: "2030-08-08"
    },
    "MS355-24X": {
      eos: "2025-08-08",
      eost: "2030-08-08"
    },
    "MS355-24X2": {
      eos: "2025-08-08",
      eost: "2030-08-08"
    },
    "MS355-48X": {
      eos: "2025-05-30",
      eost: "2030-08-08"
    },
    "MS355-48X2": {
      eos: "2025-08-08",
      eost: "2030-08-08"
    },
    "MS390-24": {
      eos: "2025-03-28",
      eost: "2032-03-28"
    },
    "MS390-24P": {
      eos: "2025-03-28",
      eost: "2032-03-28"
    },
    "MS390-24U": {
      eos: "2025-03-28",
      eost: "2032-03-28"
    },
    "MS390-24UX": {
      eos: "2025-03-28",
      eost: "2032-03-28"
    },
    "MS390-48": {
      eos: "2025-03-28",
      eost: "2032-03-28"
    },
    "MS390-48P": {
      eos: "2025-03-28",
      eost: "2032-03-28"
    },
    "MS390-48U": {
      eos: "2025-03-28",
      eost: "2032-03-28"
    },
    "MS390-48UX": {
      eos: "2025-03-28",
      eost: "2032-03-28"
    },
    "MS390-48UX2": {
      eos: "2025-02-13",
      eost: "2032-04-04"
    },
    "MS410-16": {
      eos: "2024-09-28",
      eost: "2029-09-28"
    },
    "MS410-32": {
      eos: "2024-09-28",
      eost: "2029-09-28"
    },
    "MS420-24": {
      eos: "2016-10-31",
      eost: "2023-10-31"
    },
    "MS420-48": {
      eos: "2016-10-31",
      eost: "2023-10-31"
    },
    "MS425-16": {
      eos: "2024-06-24",
      eost: "2029-09-28"
    },
    "MS425-32": {
      eos: "2024-06-24",
      eost: "2029-09-28"
    },
    MR12: {
      eos: "2015-10-24",
      eost: "2022-10-24"
    },
    MR16: {
      eos: "2014-05-31",
      eost: "2021-05-31"
    },
    MR18: {
      eos: "2017-02-13",
      eost: "2024-03-31"
    },
    MR20: {
      eos: "2023-06-01",
      eost: "2028-06-13"
    },
    MR24: {
      eos: "2014-05-31",
      eost: "2021-05-31"
    },
    MR26: {
      eos: "2016-05-09",
      eost: "2023-05-09"
    },
    MR30H: {
      eos: "2022-05-31",
      eost: "2027-07-26"
    },
    MR32: {
      eos: "2017-04-30",
      eost: "2024-07-31"
    },
    MR33: {
      eos: "2021-05-07",
      eost: "2026-07-21"
    },
    MR34: {
      eos: "2016-10-31",
      eost: "2023-10-31"
    },
    MR42: {
      eos: "2022-07-14",
      eost: "2026-07-21"
    },
    MR42E: {
      eos: "2022-04-22",
      eost: "2026-07-21"
    },
    MR45: {
      eos: "2021-07-21",
      eost: "2026-07-21"
    },
    MR52: {
      eos: "2022-04-07",
      eost: "2026-07-21"
    },
    MR53: {
      eos: "2021-05-07",
      eost: "2026-07-21"
    },
    MR53E: {
      eos: "2022-04-07",
      eost: "2026-07-21"
    },
    MR55: {
      eos: "2022-04-07",
      eost: "2027-08-01"
    },
    MR56: {
      eos: "2025-08-07",
      eost: "2030-08-07"
    },
    MR62: {
      eos: "2017-11-15",
      eost: "2024-11-15"
    },
    MR66: {
      eos: "2017-06-09",
      eost: "2024-06-09"
    },
    MR70: {
      eos: "2024-02-19",
      eost: "2029-02-19"
    },
    MR72: {
      eos: "2017-04-30",
      eost: "2024-04-30"
    },
    MR74: {
      eos: "2021-07-21",
      eost: "2026-07-21"
    },
    MR84: {
      eos: "2021-05-07",
      eost: "2026-07-21"
    },
    MV12N: {
      eos: "2025-12-31",
      eost: "2030-12-31"
    },
    MV12W: {
      eos: "2025-12-31",
      eost: "2030-12-31"
    },
    MV12WE: {
      eos: "2025-12-31",
      eost: "2030-12-31"
    },
    MV21: {
      eos: "2019-06-19",
      eost: "2026-06-19"
    },
    MV22: {
      eos: "2025-12-31",
      eost: "2030-12-31"
    },
    MV22X: {
      eos: "2025-12-31",
      eost: "2030-12-31"
    },
    MV32: {
      eos: "2025-12-31",
      eost: "2030-12-31"
    },
    MV52: {
      eos: "2025-12-31",
      eost: "2030-12-31"
    },
    MV71: {
      eos: "2019-06-19",
      eost: "2026-06-19"
    },
    MV72: {
      eos: "2025-12-31",
      eost: "2030-12-31"
    },
    MV72X: {
      eos: "2025-12-31",
      eost: "2030-12-31"
    },
    MX60: {
      eos: "2015-10-24",
      eost: "2022-10-24"
    },
    MX60W: {
      eos: "2015-10-24",
      eost: "2022-10-24"
    },
    MX64: {
      eos: "2022-07-26",
      eost: "2027-07-26"
    },
    MX64W: {
      eos: "2022-07-26",
      eost: "2027-07-26"
    },
    MX65: {
      eos: "2019-05-28",
      eost: "2026-05-28"
    },
    MX65W: {
      eos: "2019-05-28",
      eost: "2026-05-28"
    },
    MX80: {
      eos: "2016-08-30",
      eost: "2023-08-30"
    },
    MX84: {
      eos: "2021-10-31",
      eost: "2026-10-31"
    },
    MX100: {
      eos: "2022-02-01",
      eost: "2027-02-01"
    },
    MX400: {
      eos: "2018-05-20",
      eost: "2025-05-20"
    },
    MX600: {
      eos: "2018-05-20",
      eost: "2025-05-20"
    },
    MG21: {
      eos: "2025-03-18",
      eost: "2029-09-18"
    },
    MG21E: {
      eos: "2024-09-18",
      eost: "2029-09-18"
    },
    MG51: {
      eos: "2025-11-28",
      eost: "2030-05-30"
    },
    MG51E: {
      eos: "2025-11-28",
      eost: "2030-05-30"
    },
    Z1: {
      eos: "2018-07-27",
      eost: "2025-07-27"
    },
    Z3: {
      eos: "2024-09-04",
      eost: "2029-09-04"
    },
    Z3C: {
      eos: "2024-09-04",
      eost: "2029-09-04"
    }
  },
  _EOL_REPLACEMENTS: {
    MR12: "MR28",
    MR16: "MR28",
    MR18: "MR28",
    MR24: "MR36",
    MR26: "MR36",
    MR30H: "MR36H",
    MR32: "MR36",
    MR33: "MR36",
    MR34: "MR44",
    MR42: "MR44",
    MR42E: "MR46E",
    MR52: "MR57",
    MR53: "MR57",
    MR53E: "MR57",
    MR56: "MR57",
    MR74: "MR76",
    MR62: "MR76",
    MR66: "MR78",
    MR72: "MR86",
    MR84: "MR86",
    MX60: "MX67",
    MX60W: "MX67W",
    MX64: "MX67",
    MX64W: "MX67W",
    MX65: "MX68",
    MX65W: "MX68W",
    MX80: "MX85",
    MX84: "MX85",
    MX100: "MX95",
    MX400: "MX450",
    MX600: "MX450",
    MV21: "MV23M",
    MG21: "MG41",
    MG21E: "MG41E",
    Z1: "Z4",
    Z3: "Z4",
    Z3C: "Z4C",
    MS120: "MS130",
    "MS120-8": "MS130-8",
    "MS120-8LP": "MS130-8P",
    "MS120-8FP": "MS130-8P",
    "MS120-24": "MS130-24",
    "MS120-24P": "MS130-24P",
    "MS120-48": "MS130-48",
    "MS120-48LP": "MS130-48P",
    "MS120-48FP": "MS130-48P",
    MS125: "MS130",
    "MS125-24": "MS130-24",
    "MS125-24P": "MS130-24P",
    "MS125-48": "MS130-48",
    "MS125-48LP": "MS130-48P",
    "MS125-48FP": "MS130-48P",
    MS210: "MS150",
    "MS210-24": [
      "MS150-24T-4G",
      "MS150-24T-4X"
    ],
    "MS210-24P": [
      "MS150-24P-4G",
      "MS150-24P-4X"
    ],
    "MS210-48": [
      "MS150-48T-4G",
      "MS150-48T-4X"
    ],
    "MS210-48LP": [
      "MS150-48LP-4G",
      "MS150-48LP-4X"
    ],
    "MS210-48FP": [
      "MS150-48FP-4G",
      "MS150-48FP-4X"
    ],
    MS220: "MS130",
    "MS220-8": "MS130-8",
    "MS220-8P": "MS130-8P",
    "MS220-24": "MS130-24",
    "MS220-24P": "MS130-24P",
    "MS220-48": "MS130-48",
    "MS220-48LP": "MS130-48P",
    "MS220-48FP": "MS130-48P",
    MS225: "MS150",
    "MS225-24": [
      "MS150-24T-4G",
      "MS150-24T-4X"
    ],
    "MS225-24P": [
      "MS150-24P-4G",
      "MS150-24P-4X"
    ],
    "MS225-48": [
      "MS150-48T-4G",
      "MS150-48T-4X"
    ],
    "MS225-48LP": [
      "MS150-48LP-4G",
      "MS150-48LP-4X"
    ],
    "MS225-48FP": [
      "MS150-48FP-4G",
      "MS150-48FP-4X"
    ],
    MS250: "C9300L",
    "MS250-24": "C9300L-24T-4X-M",
    "MS250-24P": "C9300L-24P-4X-M",
    "MS250-48": "C9300L-48T-4X-M",
    "MS250-48LP": "C9300L-48P-4X-M",
    "MS250-48FP": "C9300L-48PF-4X-M",
    MS320: "MS150",
    "MS320-24": [
      "MS150-24T-4G",
      "MS150-24T-4X"
    ],
    "MS320-24P": [
      "MS150-24P-4G",
      "MS150-24P-4X"
    ],
    "MS320-48": [
      "MS150-48T-4G",
      "MS150-48T-4X"
    ],
    "MS320-48LP": [
      "MS150-48LP-4G",
      "MS150-48LP-4X"
    ],
    "MS320-48FP": [
      "MS150-48FP-4G",
      "MS150-48FP-4X"
    ],
    MS355: "C9300X",
    "MS355-24X": "C9300X-24HX-M",
    "MS355-24X2": "C9300X-24HX-M",
    "MS355-48X": "C9300X-48HX-M",
    "MS355-48X2": "C9300X-48HX-M",
    MS350: "C9300",
    "MS350-24": "C9300-24T-M",
    "MS350-24P": "C9300-24P-M",
    "MS350-24X": "C9300-24UX-M",
    "MS350-48": "C9300-48T-M",
    "MS350-48LP": "C9300-48P-M",
    "MS350-48FP": "C9300-48P-M",
    MS410: "C9300",
    "MS410-16": "C9300-24S-M",
    "MS410-32": "C9300-48S-M",
    MS420: "C9300",
    "MS420-24": "C9300-24S-M",
    "MS420-48": "C9300-48S-M",
    MS425: "C9300X",
    "MS425-16": "C9300X-24Y-M",
    "MS425-32": "C9300X-24Y-M",
    MR20: "MR28",
    MR45: "MR46",
    MR55: "MR57",
    MR70: "MR78",
    MV12N: "MV13",
    MV12W: "MV13",
    MV12WE: "MV13",
    MV22: "MV23M",
    MV22X: "MV23M",
    MV32: "MV33",
    MV52: "MV53X",
    MV72: "MV73M",
    MV72X: "MV73M",
    MV71: "MV73M",
    MG51: "MG52",
    MG51E: "MG52E",
    MS390: "C9300",
    "MS390-24": "C9300-24T-M",
    "MS390-24P": "C9300-24P-M",
    "MS390-24U": "C9300-24U-M",
    "MS390-24UX": "C9300-24UX-M",
    "MS390-48": "C9300-48T-M",
    "MS390-48P": "C9300-48P-M",
    "MS390-48U": "C9300-48U-M",
    "MS390-48UX": "C9300-48UXM-M",
    "MS390-48UX2": "C9300-48UN-M"
  },
  _COMMON_MISTAKES: {
    "MS130-13X": {
      error: "Does not exist",
      suggest: [
        "MS130-12X"
      ]
    },
    "MS130-24FP": {
      error: "FP variant not available",
      suggest: [
        "MS130-24P",
        "MS130-24X"
      ]
    },
    "MS130-48FP": {
      error: "FP variant not available",
      suggest: [
        "MS130-48P",
        "MS130-48X"
      ]
    },
    "MS150-48P": {
      error: "Must specify variant",
      suggest: [
        "MS150-48LP-4G",
        "MS150-48FP-4G",
        "MS150-48LP-4X",
        "MS150-48FP-4X"
      ]
    },
    "MS150-24P": {
      error: "Must specify variant",
      suggest: [
        "MS150-24P-4G",
        "MS150-24P-4X"
      ]
    },
    MS140: {
      error: "Family does not exist",
      suggest: [
        "MS130",
        "MS150"
      ]
    },
    MT13: {
      error: "Never existed",
      suggest: [
        "MT10",
        "MT11",
        "MT14"
      ]
    },
    CW9162: {
      error: "Must specify antenna type",
      suggest: [
        "CW9162I"
      ]
    },
    CW9163: {
      error: "Must specify antenna type",
      suggest: [
        "CW9163E"
      ]
    },
    CW9172: {
      error: "Must specify variant",
      suggest: [
        "CW9172I",
        "CW9172H"
      ]
    },
    CW9176: {
      error: "Must specify variant",
      suggest: [
        "CW9176I",
        "CW9176D1"
      ]
    },
    MV12W: {
      error: "SKU updated to MV12WE",
      suggest: [
        "MV12WE"
      ]
    },
    "MS390-48P": {
      error: "MS390 only comes in UX variants",
      suggest: [
        "MS390-48UX",
        "MS390-48UX2"
      ]
    },
    "MS390-24P": {
      error: "MS390 only comes in UX variants",
      suggest: [
        "MS390-24UX"
      ]
    },
    "MS390-48": {
      error: "MS390 only comes in UX variants",
      suggest: [
        "MS390-48UX",
        "MS390-48UX2"
      ]
    },
    "MS390-24": {
      error: "MS390 only comes in UX variants",
      suggest: [
        "MS390-24UX"
      ]
    },
    CW9174: {
      error: "Must specify antenna type",
      suggest: [
        "CW9174I"
      ]
    },
    CW9178: {
      error: "Must specify antenna type",
      suggest: [
        "CW9178I"
      ]
    }
  },
  _PASSTHROUGH: [
    "AIR-AP-BRACKET-1=",
    "AIR-AP-BRACKET-2=",
    "CW-ACC-KIT1-00",
    "CW-ANT-D1-NS-00",
    "CW-ANT-GPS1-M-00",
    "CW-ANT-GPS2-S-00",
    "CW-ANT-O1-NS-00",
    "CW-INJ-8",
    "CW-MNT-ART2-00",
    "CW9800H1-MCG",
    "LIC-DUO-ADVANTAGE-1YR",
    "LIC-DUO-ADVANTAGE-3YR",
    "LIC-DUO-ADVANTAGE-5YR",
    "LIC-DUO-ESSENTIALS-1YR",
    "LIC-DUO-ESSENTIALS-3YR",
    "LIC-DUO-ESSENTIALS-5YR",
    "LIC-DUO-PREMIER-1YR",
    "LIC-DUO-PREMIER-3YR",
    "LIC-DUO-PREMIER-5YR",
    "LIC-UMB-DNS-ADV-K9-1YR",
    "LIC-UMB-DNS-ADV-K9-3YR",
    "LIC-UMB-DNS-ADV-K9-5YR",
    "LIC-UMB-DNS-ESS-K9-1YR",
    "LIC-UMB-DNS-ESS-K9-3YR",
    "LIC-UMB-DNS-ESS-K9-5YR",
    "LIC-UMB-SIG-ADV-K9-1YR",
    "LIC-UMB-SIG-ADV-K9-3YR",
    "LIC-UMB-SIG-ADV-K9-5YR",
    "LIC-UMB-SIG-ESS-K9-1YR",
    "LIC-UMB-SIG-ESS-K9-3YR",
    "LIC-UMB-SIG-ESS-K9-5YR",
    "MA-INJ-4",
    "MA-INJ-6",
    "MA-PWR-300W-INDADP",
    "MA-PWR-CORD-TW",
    "MA-SIMTRAY-2C",
    "MA-SIMTRAY-5C",
    "LIC-SME-1YR",
    "LIC-SME-3YR",
    "LIC-SME-5YR",
    "LIC-MI-EMSC-D-1YMC-A-1YR",
    "LIC-MI-EMSC-D-1YMC-A-3YR",
    "LIC-MI-EMSC-D-1YMC-A-5YR"
  ],
  C9200L: [
    "C9200L-24P-4G-M",
    "C9200L-24P-4X-M",
    "C9200L-24PXG-2Y-M",
    "C9200L-24PXG-4X-M",
    "C9200L-24T-4G-M",
    "C9200L-24T-4X-M",
    "C9200L-48P-4G-M",
    "C9200L-48P-4X-M",
    "C9200L-48PL-4G-M",
    "C9200L-48PL-4X-M",
    "C9200L-48PXG-2Y-M",
    "C9200L-48PXG-4X-M",
    "C9200L-48T-4G-M",
    "C9200L-48T-4X-M",
    "C9200L-STA-KIT-M-O",
    "C9200L-STAK-KIT-M"
  ],
  C9300: [
    "C9300-24P-M",
    "C9300-24S-M",
    "C9300-24T-M",
    "C9300-24U-M",
    "C9300-24UX-M",
    "C9300-48P-M",
    "C9300-48S-M",
    "C9300-48T-M",
    "C9300-48U-M",
    "C9300-48UN-M",
    "C9300-48UXM-M",
    "C9300-NM-2Q-M",
    "C9300-NM-2Y-M",
    "C9300-NM-8X-M"
  ],
  C9300L: [
    "C9300L-24P-4X-M",
    "C9300L-24T-4X-M",
    "C9300L-24UXG-4X-M",
    "C9300L-48P-4X-M",
    "C9300L-48PF-4X-M",
    "C9300L-48T-4X-M",
    "C9300L-48UXG-4X-M",
    "C9300L-STAK-KIT2-M"
  ],
  C9300X: [
    "C9300X-12Y-M",
    "C9300X-24HX-M",
    "C9300X-24Y-M",
    "C9300X-48HX-M",
    "C9300X-48HXN-M",
    "C9300X-48TX-M",
    "C9300X-NM-2C-M",
    "C9300X-NM-8Y-M"
  ],
  CW: [
    "CW9162I",
    "CW9163E",
    "CW9164I",
    "CW9166D1",
    "CW9166I",
    "CW9171I",
    "CW9172H",
    "CW9172I",
    "CW9174I",
    "CW9176D1",
    "CW9176I",
    "CW9178I",
    "CW9179F",
    "CW9800H1"
  ],
  MG: [
    "MG21",
    "MG21E",
    "MG41",
    "MG41E",
    "MG51",
    "MG51E",
    "MG52",
    "MG52E"
  ],
  MR: [
    "MR28",
    "MR36",
    "MR36H",
    "MR44",
    "MR46",
    "MR46E",
    "MR52",
    "MR57",
    "MR76",
    "MR78",
    "MR86"
  ],
  MS120: [
    "MS120-48"
  ],
  MS125: [
    "MS125-24P"
  ],
  MS130: [
    "MS130-12X",
    "MS130-24",
    "MS130-24P",
    "MS130-24X",
    "MS130-48",
    "MS130-48P",
    "MS130-48X",
    "MS130-8",
    "MS130-8P",
    "MS130-8P-I",
    "MS130-8X",
    "MS130R-8P"
  ],
  MS150: [
    "MS150-24MP-4X",
    "MS150-24P-4G",
    "MS150-24P-4X",
    "MS150-24T-4G",
    "MS150-24T-4X",
    "MS150-48FP-4G",
    "MS150-48FP-4X",
    "MS150-48LP-4G",
    "MS150-48LP-4X",
    "MS150-48MP-4X",
    "MS150-48T-4G",
    "MS150-48T-4X"
  ],
  MS210: [
    "MS210-24",
    "MS210-24P",
    "MS210-48",
    "MS210-48FP",
    "MS210-48LP"
  ],
  MS225: [
    "MS225-24",
    "MS225-24P",
    "MS225-48",
    "MS225-48FP",
    "MS225-48LP"
  ],
  MS250: [
    "MS250-24P",
    "MS250-48FP"
  ],
  MS350: [
    "MS350-24X",
    "MS350-48",
    "MS350-48FP"
  ],
  MS390: [
    "MS390-24UX",
    "MS390-48UX",
    "MS390-48UX2"
  ],
  MS425: [
    "MS425-16"
  ],
  MS450: [
    "MS450-12"
  ],
  MT: [
    "MT10",
    "MT11",
    "MT12",
    "MT14",
    "MT15",
    "MT20",
    "MT30",
    "MT40"
  ],
  MV: [
    "MV12N",
    "MV12WE",
    "MV13",
    "MV13M",
    "MV2",
    "MV22",
    "MV22X",
    "MV23M",
    "MV23X",
    "MV32",
    "MV33",
    "MV33M",
    "MV52",
    "MV53X",
    "MV63",
    "MV63M",
    "MV63X",
    "MV72",
    "MV72X",
    "MV73M",
    "MV73X",
    "MV84X",
    "MV93",
    "MV93M",
    "MV93X"
  ],
  MX: [
    "MX100",
    "MX105",
    "MX250",
    "MX450",
    "MX67",
    "MX67C",
    "MX67C-NA",
    "MX67W",
    "MX68",
    "MX68CW",
    "MX68CW-NA",
    "MX68W",
    "MX75",
    "MX85",
    "MX95"
  ],
  Z: [
    "Z1",
    "Z3C",
    "Z4",
    "Z4C",
    "Z4CX",
    "Z4X"
  ],
  C8111: [
    "C8111-G2-MX"
  ],
  C8121: [
    "C8121-G2-MX"
  ],
  C8455: [
    "C8455-G2-MX"
  ]
};

// src/data/specs.json
var specs_default = {
  _generated: "2026-03-20",
  _source: "documentation.meraki.com official datasheets",
  _description: "Product specs for Claude advisory responses. Do not fabricate specs not in this file.",
  MX: {
    MX67: {
      type: "Security Appliance",
      firewallThroughput: "700 Mbps",
      vpnThroughput: "400 Mbps",
      recommendedDevices: 50,
      formFactor: "Desktop",
      wanPorts: "1x GbE dedicated + 1x GbE convertible",
      lanPorts: "3x GbE RJ45",
      poe: false,
      wireless: false,
      cellular: false
    },
    MX67W: {
      type: "Security Appliance",
      firewallThroughput: "700 Mbps",
      vpnThroughput: "400 Mbps",
      recommendedDevices: 50,
      formFactor: "Desktop",
      wanPorts: "1x GbE dedicated + 1x GbE convertible",
      lanPorts: "3x GbE RJ45",
      poe: false,
      wireless: "802.11ac Wave 2, 1.3 Gbps",
      cellular: false
    },
    MX67C: {
      type: "Security Appliance",
      firewallThroughput: "700 Mbps",
      vpnThroughput: "400 Mbps",
      recommendedDevices: 50,
      formFactor: "Desktop",
      wanPorts: "1x GbE dedicated + 1x GbE convertible",
      lanPorts: "3x GbE RJ45",
      poe: false,
      wireless: false,
      cellular: "CAT 6 LTE built-in"
    },
    MX68: {
      type: "Security Appliance",
      firewallThroughput: "700 Mbps",
      vpnThroughput: "400 Mbps",
      recommendedDevices: 50,
      formFactor: "Desktop",
      wanPorts: "2x GbE RJ45",
      lanPorts: "8x GbE RJ45",
      poe: false,
      wireless: false,
      cellular: false
    },
    MX68W: {
      type: "Security Appliance",
      firewallThroughput: "700 Mbps",
      vpnThroughput: "400 Mbps",
      recommendedDevices: 50,
      formFactor: "Desktop",
      wanPorts: "2x GbE RJ45",
      lanPorts: "8x GbE RJ45",
      poe: false,
      wireless: "802.11ac Wave 2, 1.3 Gbps",
      cellular: false
    },
    MX68CW: {
      type: "Security Appliance",
      firewallThroughput: "700 Mbps",
      vpnThroughput: "400 Mbps",
      recommendedDevices: 50,
      formFactor: "Desktop",
      wanPorts: "2x GbE RJ45",
      lanPorts: "8x GbE RJ45 (2x PoE+)",
      poe: "2 ports PoE+",
      wireless: "802.11ac Wave 2, 1.3 Gbps",
      cellular: "CAT 6 LTE built-in"
    },
    MX75: {
      type: "Security Appliance",
      firewallThroughput: "1 Gbps",
      vpnThroughput: "1 Gbps",
      recommendedDevices: 200,
      formFactor: "Desktop",
      wanPorts: "1x SFP + 2x GbE RJ45 (3 total)",
      lanPorts: "8x GbE RJ45 + 2x GbE RJ45 PoE+ (10 total)",
      poe: "2 LAN ports PoE+",
      maxVpnTunnels: 75,
      wireless: false,
      cellular: false
    },
    MX85: {
      type: "Security Appliance",
      firewallThroughput: "1 Gbps",
      vpnThroughput: "1 Gbps",
      recommendedDevices: 250,
      formFactor: "Rack mount",
      wanPorts: "2x SFP + 2x GbE RJ45 (PoE+ on port 4) (4 total)",
      lanPorts: "8x GbE RJ45 + 2x SFP (10 total)",
      poe: "PoE+ on WAN port 4",
      maxVpnTunnels: 200,
      mgmtPort: true,
      wireless: false,
      cellular: false
    },
    MX95: {
      type: "Security Appliance",
      firewallThroughput: "3 Gbps",
      vpnThroughput: "2.5 Gbps",
      recommendedDevices: 500,
      formFactor: "Rack mount (1U)",
      wanPorts: "2x 10G SFP+ + 1x 2.5G RJ45 + 1x 2.5G RJ45 PoE+ (4 total)",
      lanPorts: "4x GbE RJ45 + 2x 10G SFP+ (6 total)",
      poe: "PoE+ on 1x 2.5G WAN port",
      maxVpnTunnels: 250,
      wireless: false,
      cellular: false
    },
    MX105: {
      type: "Security Appliance",
      firewallThroughput: "5 Gbps",
      vpnThroughput: "3.5 Gbps",
      recommendedDevices: 750,
      formFactor: "Rack mount (1U)",
      wanPorts: "2x 10G SFP+ + 1x 2.5G RJ45 + 1x 2.5G RJ45 PoE+ (4 total)",
      lanPorts: "4x GbE RJ45 + 2x 10G SFP+ (6 total)",
      poe: "PoE+ on 1x 2.5G WAN port",
      maxVpnTunnels: 500,
      dualPsu: true,
      wireless: false,
      cellular: false
    },
    MX250: {
      type: "Security Appliance",
      firewallThroughput: "7.5 Gbps (NAT) / 2 Gbps (NGFW)",
      vpnThroughput: "4 Gbps",
      recommendedDevices: 2e3,
      formFactor: "Rack mount",
      wanPorts: "2x 10G SFP+",
      lanPorts: "8x 10G SFP+ + 8x 1G SFP + 8x GbE RJ45 (24 total)",
      poe: false,
      wireless: false,
      cellular: false
    },
    MX450: {
      type: "Security Appliance",
      firewallThroughput: "10 Gbps (NAT) / 5 Gbps (NGFW)",
      vpnThroughput: "6.5 Gbps",
      recommendedDevices: 1e4,
      formFactor: "Rack mount",
      wanPorts: "2x 10G SFP+",
      lanPorts: "8x 10G SFP+ + 8x 1G SFP + 8x GbE RJ45 (24 total)",
      poe: false,
      wireless: false,
      cellular: false
    },
    "C8111-G2-MX": {
      type: "Security Appliance (Next-Gen, replaces MX67)",
      firewallThroughput: "2 Gbps",
      vpnThroughput: "1.2 Gbps",
      recommendedDevices: 200,
      formFactor: "Desktop",
      wanPorts: "2x 2.5G mGig RJ45 (1x PoE+, 30W for cellular gateway)",
      lanPorts: "4x 1 GbE RJ45 (1x PoE, 45W budget)",
      poe: "1x LAN PoE (45W) + 1x WAN PoE+ (30W)",
      wireless: false,
      cellular: false,
      notes: "Catalyst-based hardware running MX OS. 2.5G WAN uplinks. Replaces MX67 with ~3x throughput. Licensed as C8K-G2-MX Small."
    },
    "C8121-G2-MX": {
      type: "Security Appliance (Next-Gen, replaces MX68)",
      firewallThroughput: "2 Gbps",
      vpnThroughput: "1.2 Gbps",
      recommendedDevices: 200,
      formFactor: "Desktop",
      wanPorts: "2x 2.5G mGig RJ45 (1x PoE+, 30W for cellular gateway)",
      lanPorts: "10x 1 GbE RJ45 (3x PoE, 45W budget)",
      poe: "3x LAN PoE (45W) + 1x WAN PoE+ (30W)",
      wireless: false,
      cellular: false,
      notes: "Catalyst-based hardware running MX OS. 2.5G WAN uplinks. Replaces MX68 with ~3x throughput and more LAN ports/PoE. Licensed as C8K-G2-MX Small."
    }
  },
  MR: {
    MR28: {
      type: "Access Point",
      wifiStandard: "Wi-Fi 6 (802.11ax)",
      radioConfig: "2x2:2 dual-band",
      maxDataRate: "1.5 Gbps",
      bands: "2.4 GHz, 5 GHz",
      environment: "Indoor",
      poeRequirement: "802.3af (15W max)",
      ethernetPorts: "1x GbE RJ45"
    },
    MR36: {
      type: "Access Point",
      wifiStandard: "Wi-Fi 6 (802.11ax)",
      radioConfig: "2x2:2 dual-band + scanning + BLE",
      maxDataRate: "1.5 Gbps",
      bands: "2.4 GHz, 5 GHz",
      environment: "Indoor",
      poeRequirement: "802.3af (15W max)",
      ethernetPorts: "1x GbE RJ45"
    },
    MR36H: {
      type: "Access Point",
      wifiStandard: "Wi-Fi 6 (802.11ax)",
      radioConfig: "2x2:2 dual-band",
      maxDataRate: "1.5 Gbps",
      bands: "2.4 GHz, 5 GHz",
      environment: "Indoor wall-plate (hospitality)",
      poeRequirement: "802.3af",
      ethernetPorts: "1x GbE uplink + passthrough ports"
    },
    MR44: {
      type: "Access Point",
      wifiStandard: "Wi-Fi 6 (802.11ax)",
      radioConfig: "2x2:2 (2.4G) + 4x4:4 (5G) + scanning + BLE",
      maxDataRate: "2.7 Gbps",
      bands: "2.4 GHz, 5 GHz",
      environment: "Indoor",
      poeRequirement: "802.3at (PoE+), 802.3af low-power mode",
      ethernetPorts: "1x 2.5G mGig RJ45"
    },
    MR46: {
      type: "Access Point",
      wifiStandard: "Wi-Fi 6 (802.11ax)",
      radioConfig: "4x4:4 dual-band + scanning + BLE",
      maxDataRate: "3.0 Gbps",
      bands: "2.4 GHz, 5 GHz",
      environment: "Indoor",
      poeRequirement: "802.3at (30W max)",
      ethernetPorts: "1x 2.5G mGig RJ45"
    },
    MR46E: {
      type: "Access Point",
      wifiStandard: "Wi-Fi 6 (802.11ax)",
      radioConfig: "4x4:4 dual-band + scanning + BLE, external antennas",
      maxDataRate: "3.0 Gbps",
      bands: "2.4 GHz, 5 GHz",
      environment: "Indoor (external antenna)",
      poeRequirement: "802.3at (30W max)",
      ethernetPorts: "1x 2.5G mGig RJ45"
    },
    MR52: {
      type: "Access Point",
      wifiStandard: "Wi-Fi 6 (802.11ax)",
      radioConfig: "4x4:4 dual-band + scanning + BLE",
      maxDataRate: "3.0 Gbps",
      bands: "2.4 GHz, 5 GHz",
      environment: "Indoor (high density)",
      poeRequirement: "802.3at",
      ethernetPorts: "1x 2.5G mGig RJ45"
    },
    MR57: {
      type: "Access Point",
      wifiStandard: "Wi-Fi 6E (802.11ax)",
      radioConfig: "4x4:4 tri-band + scanning + BLE",
      maxDataRate: "7.78 Gbps",
      bands: "2.4 GHz, 5 GHz, 6 GHz",
      environment: "Indoor",
      poeRequirement: "802.3at/802.3bt",
      ethernetPorts: "2x 5G mGig RJ45"
    },
    MR76: {
      type: "Access Point",
      wifiStandard: "Wi-Fi 6 (802.11ax)",
      radioConfig: "2x2:2 dual-band + scanning + BLE",
      maxDataRate: "1.5 Gbps",
      bands: "2.4 GHz, 5 GHz",
      environment: "Outdoor (IP67)",
      poeRequirement: "802.3af (15W max)",
      ethernetPorts: "1x GbE RJ45"
    },
    MR78: {
      type: "Access Point",
      wifiStandard: "Wi-Fi 6 (802.11ax)",
      radioConfig: "2x2:2 dual-band + BLE",
      maxDataRate: "1.5 Gbps",
      bands: "2.4 GHz, 5 GHz",
      environment: "Outdoor (IP67)",
      poeRequirement: "802.3af (15W max)",
      ethernetPorts: "1x GbE RJ45"
    },
    MR86: {
      type: "Access Point",
      wifiStandard: "Wi-Fi 6 (802.11ax)",
      radioConfig: "4x4:4 dual-band + scanning + BLE",
      maxDataRate: "3.0 Gbps",
      bands: "2.4 GHz, 5 GHz",
      environment: "Outdoor (IP67)",
      poeRequirement: "802.3at (30W max)",
      ethernetPorts: "1x 2.5G mGig RJ45"
    }
  },
  CW: {
    CW9162I: {
      type: "Access Point",
      wifiStandard: "Wi-Fi 6E (802.11ax)",
      radioConfig: "2x2:2 tri-band + scanning + BLE",
      maxDataRate: "3.9 Gbps",
      bands: "2.4 GHz, 5 GHz, 6 GHz",
      environment: "Indoor",
      poeRequirement: "802.3at (30W max)",
      ethernetPorts: "1x 2.5G mGig RJ45"
    },
    CW9163E: {
      type: "Access Point",
      wifiStandard: "Wi-Fi 6E (802.11ax)",
      radioConfig: "2x2:2 tri-band + scanning + BLE, external antennas",
      maxDataRate: "3.9 Gbps",
      bands: "2.4 GHz, 5 GHz, 6 GHz",
      environment: "Outdoor / external antenna",
      poeRequirement: "802.3at",
      ethernetPorts: "1x 2.5G mGig RJ45"
    },
    CW9164I: {
      type: "Access Point",
      wifiStandard: "Wi-Fi 6E (802.11ax)",
      radioConfig: "2x2:2 (2.4G) + 4x4:4 (5G + 6G) + scanning + BLE",
      maxDataRate: "7.49 Gbps",
      bands: "2.4 GHz, 5 GHz, 6 GHz",
      environment: "Indoor",
      poeRequirement: "802.3bt (UPoE) 30.5W / 802.3at 25W",
      ethernetPorts: "1x 2.5G mGig RJ45"
    },
    CW9166I: {
      type: "Access Point",
      wifiStandard: "Wi-Fi 6E (802.11ax)",
      radioConfig: "4x4:4 tri-band + scanning + BLE",
      maxDataRate: "7.78 Gbps",
      bands: "2.4 GHz, 5 GHz, 6 GHz",
      environment: "Indoor (omnidirectional)",
      poeRequirement: "802.3at (PoE+) / 802.3bt (UPoE)",
      ethernetPorts: "1x 5G mGig RJ45"
    },
    CW9166D1: {
      type: "Access Point",
      wifiStandard: "Wi-Fi 6E (802.11ax)",
      radioConfig: "4x4:4 tri-band + scanning + BLE",
      maxDataRate: "7.78 Gbps",
      bands: "2.4 GHz, 5 GHz, 6 GHz",
      environment: "Indoor (directional, high-ceiling)",
      poeRequirement: "802.3at (PoE+) / 802.3bt (UPoE)",
      ethernetPorts: "1x 5G mGig RJ45"
    },
    CW9172H: {
      type: "Access Point",
      wifiStandard: "Wi-Fi 7 (802.11be)",
      radioConfig: "Tri-band (2.4/5/6 GHz) + scanning + BLE",
      maxDataRate: "9 Gbps",
      bands: "2.4 GHz, 5 GHz, 6 GHz",
      environment: "Indoor wall-plate (Hospitality)",
      poeRequirement: "802.3bt/802.3at/802.3af (32W max)",
      ethernetPorts: "1x 2.5G mGig uplink + 3x GbE LAN (1x PoE out) + 1x passthrough"
    }
  },
  MS130: {
    _family: "Cloud-managed access switch",
    "MS130-8": { ports: "8x GbE", uplinks: "2x 1G SFP", poe: "None", switchingCapacity: "20 Gbps" },
    "MS130-8P": { ports: "8x GbE", uplinks: "2x 1G SFP", poe: "120W", switchingCapacity: "20 Gbps" },
    "MS130-8P-I": { ports: "8x GbE", uplinks: "2x 1G SFP", poe: "120W (internal PSU)", switchingCapacity: "20 Gbps" },
    "MS130-8X": { ports: "6x GbE + 2x 2.5G mGig", uplinks: "2x 10G SFP+", poe: "120W", switchingCapacity: "62 Gbps" },
    "MS130-12X": { ports: "8x GbE + 4x 2.5G mGig", uplinks: "2x 10G SFP+", poe: "240W", switchingCapacity: "76 Gbps" },
    "MS130-24": { ports: "24x GbE", uplinks: "4x 1G SFP", poe: "None", switchingCapacity: "56 Gbps" },
    "MS130-24P": { ports: "24x GbE", uplinks: "4x 1G SFP", poe: "370W", switchingCapacity: "56 Gbps" },
    "MS130-24X": { ports: "18x GbE + 6x 2.5G mGig", uplinks: "4x 10G SFP+", poe: "370W", switchingCapacity: "146 Gbps" },
    "MS130-48": { ports: "48x GbE", uplinks: "4x 1G SFP", poe: "None", switchingCapacity: "104 Gbps" },
    "MS130-48P": { ports: "48x GbE", uplinks: "4x 1G SFP", poe: "740W", switchingCapacity: "104 Gbps" },
    "MS130-48X": { ports: "40x GbE + 8x 2.5G mGig", uplinks: "4x 10G SFP+", poe: "740W", switchingCapacity: "200 Gbps" }
  },
  MS150: {
    _family: "Cloud-managed stackable access switch",
    _stacking: "80 Gbps via 2x dedicated stack ports",
    "MS150-24T-4G": { ports: "24x GbE", uplinks: "4x 1G SFP", poe: "None", switchingCapacity: "56 Gbps" },
    "MS150-24P-4G": { ports: "24x GbE", uplinks: "4x 1G SFP", poe: "370W (30W/port)", switchingCapacity: "56 Gbps" },
    "MS150-24T-4X": { ports: "24x GbE", uplinks: "4x 10G SFP+", poe: "None", switchingCapacity: "128 Gbps" },
    "MS150-24P-4X": { ports: "24x GbE", uplinks: "4x 10G SFP+", poe: "370W (30W/port)", switchingCapacity: "128 Gbps" },
    "MS150-24MP-4X": { ports: "16x GbE + 8x 5G mGig", uplinks: "4x 10G SFP+", poe: "370W (60W/port)", switchingCapacity: "192 Gbps" },
    "MS150-48T-4G": { ports: "48x GbE", uplinks: "4x 1G SFP", poe: "None", switchingCapacity: "104 Gbps" },
    "MS150-48LP-4G": { ports: "48x GbE", uplinks: "4x 1G SFP", poe: "370W (30W/port)", switchingCapacity: "104 Gbps" },
    "MS150-48FP-4G": { ports: "48x GbE", uplinks: "4x 1G SFP", poe: "740W (30W/port)", switchingCapacity: "104 Gbps" },
    "MS150-48T-4X": { ports: "48x GbE", uplinks: "4x 10G SFP+", poe: "None", switchingCapacity: "176 Gbps" },
    "MS150-48LP-4X": { ports: "48x GbE", uplinks: "4x 10G SFP+", poe: "370W (30W/port)", switchingCapacity: "176 Gbps" },
    "MS150-48FP-4X": { ports: "48x GbE", uplinks: "4x 10G SFP+", poe: "740W (30W/port)", switchingCapacity: "176 Gbps" },
    "MS150-48MP-4X": { ports: "32x GbE + 16x 5G mGig", uplinks: "4x 10G SFP+", poe: "740W (60W/port)", switchingCapacity: "304 Gbps" }
  },
  MS390: {
    _family: "Cloud-managed aggregation switch with modular uplinks",
    _stacking: "480 Gbps",
    "MS390-24UX": { ports: "24x mGig (up to 10G)", uplinks: "Modular 10/40G", poe: "560W", switchingCapacity: "640 Gbps" },
    "MS390-48UX": { ports: "36x 2.5G + 12x 10G mGig", uplinks: "Modular 10/40G", poe: "490W", switchingCapacity: "580 Gbps" },
    "MS390-48UX2": { ports: "48x 5G mGig", uplinks: "Modular 10/40G", poe: "645W", switchingCapacity: "640 Gbps" }
  },
  MS450: {
    _family: "Cloud-managed aggregation switch",
    "MS450-12": { ports: "12x 25G SFP28", uplinks: "2x 100G QSFP28", poe: "None", switchingCapacity: "1.2 Tbps" }
  },
  "C9300X-M": {
    _family: "Catalyst 9300X-M cloud-managed with IOS-XE (high-performance)",
    _stacking: "1 Tbps / 480 Gbps",
    "C9300X-12Y-M": { ports: "12x 1/10/25G SFP28", uplinks: "Modular 10/25/40/100G", poe: "None", switchingCapacity: "1 Tbps" },
    "C9300X-24Y-M": { ports: "24x 1/10/25G SFP28", uplinks: "Modular 10/25/40/100G", poe: "None", switchingCapacity: "2 Tbps" },
    "C9300X-24HX-M": { ports: "24x 10G mGig UPoE+ RJ45", uplinks: "Modular", poe: "735W (single) / 1835W (dual)", switchingCapacity: "880 Gbps" },
    "C9300X-48TX-M": { ports: "48x 10G mGig RJ45", uplinks: "Modular", poe: "None", switchingCapacity: "2 Tbps" },
    "C9300X-48HX-M": { ports: "48x 10G mGig UPoE+ RJ45", uplinks: "Modular", poe: "590W (single) / 1690W (dual)", switchingCapacity: "2 Tbps" },
    "C9300X-48HXN-M": { ports: "8x 10G + 40x 5G mGig UPoE+ RJ45", uplinks: "Modular", poe: "690W (single) / 1790W (dual)", switchingCapacity: "2 Tbps" }
  },
  "C9300-M": {
    _family: "Catalyst 9300-M cloud-managed with IOS-XE (standard)",
    "C9300-24T-M": { ports: "24x 1G RJ45", uplinks: "Modular 1G/10G/25G", poe: "None", switchingCapacity: "208 Gbps" },
    "C9300-24P-M": { ports: "24x 1G RJ45", uplinks: "Modular 1G/10G/25G", poe: "445W PoE+", switchingCapacity: "208 Gbps" },
    "C9300-24U-M": { ports: "24x 1G RJ45", uplinks: "Modular 1G/10G/25G", poe: "800W UPoE", switchingCapacity: "208 Gbps" },
    "C9300-24UX-M": { ports: "24x mGig (8x 10G + 16x 1G)", uplinks: "Modular 1G/10G/25G", poe: "800W UPoE", switchingCapacity: "480 Gbps" },
    "C9300-48T-M": { ports: "48x 1G RJ45", uplinks: "Modular 1G/10G/25G", poe: "None", switchingCapacity: "208 Gbps" },
    "C9300-48P-M": { ports: "48x 1G RJ45", uplinks: "Modular 1G/10G/25G", poe: "445W PoE+", switchingCapacity: "208 Gbps" },
    "C9300-48U-M": { ports: "48x 1G RJ45", uplinks: "Modular 1G/10G/25G", poe: "800W UPoE", switchingCapacity: "208 Gbps" },
    "C9300-48UXM-M": { ports: "48x mGig (36x 10G + 12x 1G)", uplinks: "Modular 1G/10G/25G", poe: "490W UPoE", switchingCapacity: "880 Gbps" }
  },
  "C9300L-M": {
    _family: "Catalyst 9300L-M cloud-managed with IOS-XE (compact/cost-optimized)",
    "C9300L-24T-4G-M": { ports: "24x 1G RJ45", uplinks: "4x 1G SFP", poe: "None", switchingCapacity: "56 Gbps" },
    "C9300L-24P-4G-M": { ports: "24x 1G RJ45", uplinks: "4x 1G SFP", poe: "445W PoE+", switchingCapacity: "56 Gbps" },
    "C9300L-24T-4X-M": { ports: "24x 1G RJ45", uplinks: "4x 10G SFP+", poe: "None", switchingCapacity: "128 Gbps" },
    "C9300L-24P-4X-M": { ports: "24x 1G RJ45", uplinks: "4x 10G SFP+", poe: "445W PoE+", switchingCapacity: "128 Gbps" },
    "C9300L-48T-4G-M": { ports: "48x 1G RJ45", uplinks: "4x 1G SFP", poe: "None", switchingCapacity: "104 Gbps" },
    "C9300L-48P-4G-M": { ports: "48x 1G RJ45", uplinks: "4x 1G SFP", poe: "445W PoE+", switchingCapacity: "104 Gbps" },
    "C9300L-48T-4X-M": { ports: "48x 1G RJ45", uplinks: "4x 10G SFP+", poe: "None", switchingCapacity: "176 Gbps" },
    "C9300L-48P-4X-M": { ports: "48x 1G RJ45", uplinks: "4x 10G SFP+", poe: "445W PoE+", switchingCapacity: "176 Gbps" }
  },
  "C9200L-M": {
    _family: "Catalyst 9200L-M cloud-managed with IOS-XE (entry-level)",
    _stacking: "80 Gbps, up to 8 switches",
    "C9200L-24T-4G-M": { ports: "24x 1G RJ45", uplinks: "4x 1G SFP", poe: "None", switchingCapacity: "56 Gbps" },
    "C9200L-24P-4G-M": { ports: "24x 1G RJ45", uplinks: "4x 1G SFP", poe: "370W PoE+", switchingCapacity: "56 Gbps" },
    "C9200L-24T-4X-M": { ports: "24x 1G RJ45", uplinks: "4x 10G SFP+", poe: "None", switchingCapacity: "128 Gbps" },
    "C9200L-24P-4X-M": { ports: "24x 1G RJ45", uplinks: "4x 10G SFP+", poe: "370W PoE+", switchingCapacity: "128 Gbps" },
    "C9200L-24PXG-4X-M": { ports: "24x PoE+ (8x mGig + 16x 1G)", uplinks: "4x 10G SFP+", poe: "370W PoE+", switchingCapacity: "272 Gbps" },
    "C9200L-24PXG-2Y-M": { ports: "24x PoE+ (8x mGig + 16x 1G)", uplinks: "2x 25G SFP28", poe: "370W PoE+", switchingCapacity: "292 Gbps" },
    "C9200L-48T-4G-M": { ports: "48x 1G RJ45", uplinks: "4x 1G SFP", poe: "None", switchingCapacity: "104 Gbps" },
    "C9200L-48P-4G-M": { ports: "48x 1G RJ45", uplinks: "4x 1G SFP", poe: "740W PoE+", switchingCapacity: "104 Gbps" },
    "C9200L-48PL-4G-M": { ports: "48x 1G RJ45 (partial PoE+)", uplinks: "4x 1G SFP", poe: "370W PoE+", switchingCapacity: "104 Gbps" },
    "C9200L-48T-4X-M": { ports: "48x 1G RJ45", uplinks: "4x 10G SFP+", poe: "None", switchingCapacity: "176 Gbps" },
    "C9200L-48P-4X-M": { ports: "48x 1G RJ45", uplinks: "4x 10G SFP+", poe: "740W PoE+", switchingCapacity: "176 Gbps" },
    "C9200L-48PL-4X-M": { ports: "48x 1G RJ45 (partial PoE+)", uplinks: "4x 10G SFP+", poe: "370W PoE+", switchingCapacity: "176 Gbps" },
    "C9200L-48PXG-4X-M": { ports: "48x PoE+ (12x mGig + 36x 1G)", uplinks: "4x 10G SFP+", poe: "740W PoE+", switchingCapacity: "392 Gbps" },
    "C9200L-48PXG-2Y-M": { ports: "48x PoE+ (8x mGig + 40x 1G)", uplinks: "2x 25G SFP28", poe: "740W PoE+", switchingCapacity: "340 Gbps" }
  },
  Z: {
    Z4: {
      type: "Teleworker Gateway",
      firewallThroughput: "500 Mbps",
      vpnThroughput: "250 Mbps",
      recommendedDevices: 15,
      formFactor: "Desktop",
      wanPorts: "1x GbE",
      lanPorts: "4x GbE (1x PoE+)",
      poe: "1x PoE+ LAN port",
      wireless: "Wi-Fi 6 (802.11ax) 2x2 MU-MIMO, 1.5 Gbps",
      cellular: false
    },
    Z4C: {
      type: "Teleworker Gateway",
      firewallThroughput: "500 Mbps",
      vpnThroughput: "250 Mbps",
      recommendedDevices: 15,
      formFactor: "Desktop",
      wanPorts: "1x GbE + CAT 12 LTE modem",
      lanPorts: "4x GbE (1x PoE+)",
      poe: "1x 802.3at PoE+ LAN port",
      wireless: "Wi-Fi 6 (802.11ax) 2x2 MU-MIMO, 1.5 Gbps",
      cellular: "CAT 12 LTE built-in"
    },
    Z4X: {
      type: "Teleworker Gateway",
      firewallThroughput: "500 Mbps",
      vpnThroughput: "250 Mbps",
      recommendedDevices: 15,
      formFactor: "Desktop",
      note: "Enhanced model, see datasheet for port details"
    },
    Z4CX: {
      type: "Teleworker Gateway",
      firewallThroughput: "500 Mbps",
      vpnThroughput: "250 Mbps",
      recommendedDevices: 15,
      formFactor: "Desktop",
      cellular: "Built-in LTE",
      note: "Enhanced cellular model, see datasheet for port details"
    }
  },
  MV: {
    _family: "Smart cameras with built-in storage and edge analytics",
    MV2: { resolution: "4MP", type: "Indoor mini dome", fov: "113\xB0 H" },
    MV13: { resolution: "8MP / 4K", type: "Indoor mini dome", fov: "101\xB0 H" },
    MV13M: { resolution: "8MP / 4K", type: "Indoor mini dome (M12 connector)", fov: "101\xB0 H" },
    MV22X: { resolution: "4MP", type: "Indoor varifocal dome", fov: "Varifocal" },
    MV23M: { resolution: "8MP / 4K", type: "Indoor varifocal dome (M12)", fov: "Varifocal" },
    MV23X: { resolution: "8MP / 4K", type: "Indoor varifocal dome", fov: "Varifocal" },
    MV32: { resolution: "8.4MP", type: "Indoor fisheye", fov: "360\xB0" },
    MV33: { resolution: "12.4MP", type: "Indoor mini fisheye", fov: "360\xB0" },
    MV33M: { resolution: "12.4MP", type: "Indoor mini fisheye (M12)", fov: "360\xB0" },
    MV52: { resolution: "8.4MP", type: "Outdoor fisheye", fov: "360\xB0" },
    MV53X: { resolution: "8MP / 4K", type: "Outdoor bullet", fov: "Varifocal" },
    MV63: { resolution: "8MP / 4K", type: "Outdoor dome", fov: "101\xB0 H" },
    MV63M: { resolution: "8MP / 4K", type: "Outdoor dome (M12)", fov: "101\xB0 H" },
    MV63X: { resolution: "8MP / 4K", type: "Outdoor varifocal dome", fov: "Varifocal" },
    MV72: { resolution: "4MP", type: "Outdoor dome", fov: "Varifocal" },
    MV72X: { resolution: "4MP", type: "Outdoor varifocal dome", fov: "Varifocal" },
    MV73X: { resolution: "8MP / 4K", type: "Outdoor varifocal dome", fov: "Varifocal" },
    MV73M: { resolution: "8MP / 4K", type: "Outdoor varifocal dome (M12)", fov: "Varifocal" },
    MV84X: { resolution: "20MP", type: "Outdoor multi-sensor", fov: "360\xB0" },
    MV93: { resolution: "12MP", type: "Outdoor fisheye", fov: "360\xB0" },
    MV93M: { resolution: "12MP", type: "Outdoor fisheye (M12)", fov: "360\xB0" },
    MV93X: { resolution: "12MP", type: "Outdoor fisheye (varifocal)", fov: "360\xB0" }
  },
  MT: {
    _family: "IoT sensors",
    MT10: { type: "Temperature & Humidity sensor" },
    MT11: { type: "Temperature probe sensor" },
    MT12: { type: "Water leak detection sensor" },
    MT14: { type: "Indoor air quality sensor (CO2, TVOC, PM2.5, temp, humidity)" },
    MT15: { type: "Air quality sensor (CO2, TVOC, PM2.5)" },
    MT20: { type: "Open/close door sensor" },
    MT30: { type: "Button/remote sensor" },
    MT40: { type: "Automation IO relay" }
  },
  MG: {
    _family: "Cellular gateways",
    MG21: { type: "Cellular Gateway", cellular: "CAT 6 LTE (300 Mbps down)", ports: "1x GbE WAN, 1x GbE LAN" },
    MG21E: { type: "Cellular Gateway", cellular: "CAT 6 LTE (300 Mbps down)", ports: "1x GbE WAN, 1x GbE LAN", note: "External antenna" },
    MG41: { type: "Cellular Gateway", cellular: "CAT 18 LTE (1.2 Gbps down)", ports: "1x GbE WAN, 1x GbE LAN" },
    MG41E: { type: "Cellular Gateway", cellular: "CAT 18 LTE (1.2 Gbps down)", ports: "1x GbE WAN, 1x GbE LAN", note: "External antenna" },
    MG51: { type: "Cellular Gateway", cellular: "5G Sub-6 + LTE", ports: "1x 2.5G WAN, 1x GbE LAN" },
    MG51E: { type: "Cellular Gateway", cellular: "5G Sub-6 + LTE", ports: "1x 2.5G WAN, 1x GbE LAN", note: "External antenna" },
    MG52: { type: "Cellular Gateway", cellular: "5G mmWave + Sub-6 + LTE", ports: "1x 2.5G WAN, 1x GbE LAN" },
    MG52E: { type: "Cellular Gateway", cellular: "5G mmWave + Sub-6 + LTE", ports: "1x 2.5G WAN, 1x GbE LAN", note: "External antenna" }
  }
};

// src/data/accessories.json
var accessories_default = {
  _generated: "2026-03-23",
  _source: "documentation.meraki.com SFP_and_Stacking_Accessories + product datasheets",
  _description: "Accessory compatibility engine data. SFP modules, stacking cables, uplink modules, and device port profiles for network design recommendations.",
  _live_rag_url: "https://documentation.meraki.com/General_Administration/Cross-Platform_Content/SFP_and_Stacking_Accessories",
  sfp_modules: {
    "1G_SFP": [
      {
        sku: "MA-SFP-1GB-SX",
        speed: "1G",
        type: "SFP",
        medium: "MMF",
        wavelength: "850nm",
        range: "550m (OM2) / 220m (OM1)",
        connector: "LC duplex",
        incompatible_with: [],
        use_case: "Short-range multi-mode, building backbone, most common"
      },
      {
        sku: "MA-SFP-1GB-LX10",
        speed: "1G",
        type: "SFP",
        medium: "SMF",
        wavelength: "1310nm",
        range: "10km",
        connector: "LC duplex",
        incompatible_with: [],
        use_case: "Long-range single-mode, campus backbone, between buildings"
      },
      {
        sku: "MA-SFP-1GB-TX",
        speed: "1G",
        type: "SFP",
        medium: "copper",
        wavelength: null,
        range: "100m",
        connector: "RJ45",
        incompatible_with: ["MS390", "C9300", "C9300X", "C9300L"],
        use_case: "Copper SFP for existing Cat5e/6 infrastructure, NOT supported on Catalyst or MS390"
      }
    ],
    "10G_SFP+": [
      {
        sku: "MA-SFP-10GB-SR",
        speed: "10G",
        type: "SFP+",
        medium: "MMF",
        wavelength: "850nm",
        range: "300m (OM3) / 400m (OM4) / 26m (OM1)",
        connector: "LC duplex",
        incompatible_with: [],
        use_case: "Most common 10G optic, short-range multi-mode"
      },
      {
        sku: "MA-SFP-10GB-LR",
        speed: "10G",
        type: "SFP+",
        medium: "SMF",
        wavelength: "1310nm",
        range: "10km",
        connector: "LC duplex",
        incompatible_with: [],
        use_case: "Long-range single-mode, campus/metro backbone"
      },
      {
        sku: "MA-SFP-10GB-LRM",
        speed: "10G",
        type: "SFP+",
        medium: "MMF",
        wavelength: "1310nm",
        range: "220m (OM1) / 300m (OM3)",
        connector: "LC duplex",
        incompatible_with: ["C9300X"],
        use_case: "Medium-range multi-mode, good for legacy OM1/OM2 fiber"
      },
      {
        sku: "MA-SFP-10GB-ER",
        speed: "10G",
        type: "SFP+",
        medium: "SMF",
        wavelength: "1550nm",
        range: "40km",
        connector: "LC duplex",
        incompatible_with: [],
        use_case: "Extended reach, metro/campus with long runs"
      },
      {
        sku: "MA-SFP-10GB-ZR",
        speed: "10G",
        type: "SFP+",
        medium: "SMF",
        wavelength: "1550nm",
        range: "80km",
        connector: "LC duplex",
        incompatible_with: [],
        use_case: "Very long reach, metro rings, carrier connections"
      }
    ],
    "10G_DAC": [
      {
        sku: "MA-CBL-TA-1M",
        speed: "10G",
        type: "DAC",
        medium: "copper twinax",
        wavelength: null,
        range: "1m",
        connector: "SFP+ direct attach",
        incompatible_with: [],
        use_case: "Same-rack connections, cheapest 10G option, no fiber needed"
      },
      {
        sku: "MA-CBL-TA-3M",
        speed: "10G",
        type: "DAC",
        medium: "copper twinax",
        wavelength: null,
        range: "3m",
        connector: "SFP+ direct attach",
        incompatible_with: [],
        use_case: "Adjacent-rack connections, no fiber needed"
      }
    ],
    "40G_QSFP": [
      {
        sku: "MA-QSFP-40G-SR4",
        speed: "40G",
        type: "QSFP+",
        medium: "MMF",
        wavelength: "850nm",
        range: "150m (OM4) / 100m (OM3)",
        connector: "MPO-12",
        incompatible_with: [],
        use_case: "Short-range 40G, data center interconnects"
      },
      {
        sku: "MA-QSFP-40G-LR4",
        speed: "40G",
        type: "QSFP+",
        medium: "SMF",
        wavelength: "1310nm",
        range: "10km",
        connector: "LC duplex",
        incompatible_with: [],
        use_case: "Long-range 40G over single-mode fiber"
      },
      {
        sku: "MA-QSFP-40G-CSR4",
        speed: "40G",
        type: "QSFP+",
        medium: "MMF",
        wavelength: "850nm",
        range: "400m (OM4) / 300m (OM3)",
        connector: "MPO-12",
        incompatible_with: [],
        use_case: "Extended-reach 40G multi-mode, building backbone"
      },
      {
        sku: "MA-QSFP-40G-SR-BD",
        speed: "40G",
        type: "QSFP+",
        medium: "MMF",
        wavelength: "850/900nm",
        range: "150m (OM4)",
        connector: "LC duplex",
        incompatible_with: [],
        use_case: "40G over LC duplex (not MPO), reuse existing patch panels"
      }
    ],
    "100G_QSFP28": [
      {
        sku: "MA-QSFP-100G-SR4",
        speed: "100G",
        type: "QSFP28",
        medium: "MMF",
        wavelength: "850nm",
        range: "100m (OM4) / 70m (OM3)",
        connector: "MPO-12",
        incompatible_with: [],
        use_case: "Short-range 100G, MS450 uplinks"
      },
      {
        sku: "MA-QSFP-100G-LR4",
        speed: "100G",
        type: "QSFP28",
        medium: "SMF",
        wavelength: "1310nm",
        range: "10km",
        connector: "LC duplex",
        incompatible_with: [],
        use_case: "Long-range 100G, campus core"
      }
    ]
  },
  stacking: {
    families: {
      "40G": {
        cables: {
          "MA-CBL-40G-50CM": { length: "50cm", use_case: "Same-shelf stacking" },
          "MA-CBL-40G-1M": { length: "1m", use_case: "Same-rack stacking (default)" },
          "MA-CBL-40G-3M": { length: "3m", use_case: "Adjacent-rack stacking" }
        },
        bandwidth: "40 Gbps per cable",
        type: "QSFP+",
        compatible_switches: ["MS210", "MS225", "MS250", "MS350", "MS410", "MS425"],
        max_stack_size: 8,
        topology: "ring or chain",
        note: "Ring topology requires N cables for N switches. Chain requires N-1."
      },
      "100G": {
        cables: {
          "MA-CBL-100G-50CM": { length: "50cm", use_case: "Same-shelf stacking" },
          "MA-CBL-100G-1M": { length: "1m", use_case: "Same-rack stacking (default)" },
          "MA-CBL-100G-3M": { length: "3m", use_case: "Adjacent-rack stacking" }
        },
        bandwidth: "100 Gbps per cable",
        type: "QSFP28",
        compatible_switches: ["MS150", "MS355", "MS450"],
        max_stack_size: 8,
        topology: "ring or chain"
      },
      "120G_StackWise480": {
        cables: {
          "MA-CBL-120G-50CM": { length: "50cm" },
          "MA-CBL-120G-1M": { length: "1m", use_case: "Same-rack stacking (default)" },
          "MA-CBL-120G-3M": { length: "3m" }
        },
        bandwidth: "480 Gbps (4x 120G)",
        type: "StackWise-480",
        compatible_switches: ["MS390"],
        max_stack_size: 8,
        topology: "ring",
        stackpower: {
          cables: ["MA-CBL-SPWR-30CM", "MA-CBL-SPWR-150CM"],
          note: "Optional StackPower for shared power pool across stack members"
        }
      },
      "STACK-T1": {
        cables: {
          "STACK-T1-50CM-M": { length: "50cm" },
          "STACK-T1-1M-M": { length: "1m", use_case: "Same-rack stacking (default)" },
          "STACK-T1-3M-M": { length: "3m" }
        },
        bandwidth: "480 Gbps (C9300) / 1 Tbps (C9300X)",
        type: "StackWise-480/1T",
        compatible_switches: ["C9300", "C9300X"],
        max_stack_size: 8,
        topology: "ring",
        stackpower: {
          cables: ["CAB-SPWR-30CM-M", "CAB-SPWR-150CM-M"],
          note: "Optional StackPower for shared power pool"
        }
      },
      "STACK-T3A": {
        cables: {
          "STACK-T3A-50CM-M": { length: "50cm" },
          "STACK-T3A-1M-M": { length: "1m", use_case: "Same-rack stacking (default)" },
          "STACK-T3A-3M-M": { length: "3m" }
        },
        bandwidth: "320 Gbps",
        type: "StackWise-320",
        compatible_switches: ["C9300L"],
        max_stack_size: 8,
        topology: "ring",
        requires_kit: "C9300L-STACK-KIT2-M",
        kit_note: "Required stacking module, sold separately. One per switch."
      },
      "STACK-T4": {
        cables: {
          "STACK-T4-50CM-M": { length: "50cm" },
          "STACK-T4-1M-M": { length: "1m", use_case: "Same-rack stacking (default)" },
          "STACK-T4-3M-M": { length: "3m" }
        },
        bandwidth: "80 Gbps",
        type: "FlexStack-Plus",
        compatible_switches: ["C9200L"],
        max_stack_size: 8,
        topology: "ring"
      }
    },
    not_stackable: ["MS130", "MS130R"],
    rules: [
      "Only like-family switches can stack together (e.g., MS150 with MS150, NOT MS150 with MS130)",
      "Different port-count variants within a family CAN stack (e.g., MS150-24P-4X with MS150-48FP-4X)",
      "Ring topology provides redundancy - if one cable fails, stack stays up via the other path",
      "Chain topology uses N-1 cables but has no redundancy - one cable failure splits the stack",
      "For production environments, always recommend ring topology"
    ]
  },
  uplink_modules: {
    MS390: {
      modules: [
        { sku: "MA-MOD-8X10G", ports: 8, speed: "10G", type: "SFP+", in_prices: true },
        { sku: "MA-MOD-4X10G", ports: 4, speed: "10G", type: "SFP+", in_prices: false, note: "Check availability, may be EOL" },
        { sku: "MA-MOD-2X40G", ports: 2, speed: "40G", type: "QSFP+", in_prices: true }
      ],
      note: "MS390 ships without uplink module. One module required per switch."
    },
    C9300: {
      modules: [
        { sku: "C9300-NM-8X-M", ports: 8, speed: "10G", type: "SFP+", in_prices: true, recommended: true },
        { sku: "C9300-NM-2Q-M", ports: 2, speed: "40G", type: "QSFP+", in_prices: true },
        { sku: "C9300-NM-2Y-M", ports: 2, speed: "25G", type: "SFP28", in_prices: true },
        { sku: "C9300-NM-4G", ports: 4, speed: "1G", type: "SFP", in_prices: false, note: "1G only, SFP+ will NOT work" },
        { sku: "C9300-NM-4X", ports: 4, speed: "10G", type: "SFP+", in_prices: false },
        { sku: "C9300-NM-2T", ports: 2, speed: "25G", type: "SFP28", in_prices: false },
        { sku: "C9300-NM-4M", ports: 4, speed: "mGig", type: "RJ45", in_prices: false }
      ],
      note: "C9300 ships without uplink module. Module required for uplink connectivity."
    },
    C9300X: {
      modules: [
        { sku: "C9300X-NM-8Y-M", ports: 8, speed: "25G", type: "SFP28", in_prices: true },
        { sku: "C9300X-NM-2C-M", ports: 2, speed: "100G", type: "QSFP28", in_prices: true }
      ],
      note: "C9300X already has fixed high-speed ports. Modules add additional uplink capacity."
    }
  },
  port_profiles: {
    _description: "Machine-readable port profile for every device. Used by the accessory resolver to determine what connects to what.",
    MX: {
      MX67: { sfp_uplinks: [], sfp_lan: [], rj45_wan: [{ count: 2, speed: "1G" }], stackable: false },
      MX67W: { sfp_uplinks: [], sfp_lan: [], rj45_wan: [{ count: 2, speed: "1G" }], stackable: false },
      MX67C: { sfp_uplinks: [], sfp_lan: [], rj45_wan: [{ count: 2, speed: "1G" }], stackable: false },
      MX68: { sfp_uplinks: [], sfp_lan: [], rj45_wan: [{ count: 2, speed: "1G" }], stackable: false },
      MX68W: { sfp_uplinks: [], sfp_lan: [], rj45_wan: [{ count: 2, speed: "1G" }], stackable: false },
      MX68CW: { sfp_uplinks: [], sfp_lan: [], rj45_wan: [{ count: 2, speed: "1G" }], stackable: false },
      MX75: { sfp_uplinks: [{ count: 1, speed: "1G", form: "SFP" }], sfp_lan: [{ count: 2, speed: "10G", form: "SFP+" }], rj45_wan: [{ count: 2, speed: "1G" }], stackable: false },
      MX85: { sfp_uplinks: [{ count: 2, speed: "1G", form: "SFP" }], sfp_lan: [{ count: 2, speed: "10G", form: "SFP+" }], rj45_wan: [{ count: 2, speed: "1G" }], stackable: false },
      MX95: { sfp_uplinks: [{ count: 2, speed: "10G", form: "SFP+" }], sfp_lan: [{ count: 2, speed: "10G", form: "SFP+" }], rj45_wan: [{ count: 2, speed: "2.5G" }], stackable: false },
      MX105: { sfp_uplinks: [{ count: 2, speed: "10G", form: "SFP+" }], sfp_lan: [{ count: 2, speed: "10G", form: "SFP+" }], rj45_wan: [{ count: 2, speed: "2.5G" }], stackable: false },
      MX250: { sfp_uplinks: [{ count: 2, speed: "10G", form: "SFP+" }], sfp_lan: [{ count: 8, speed: "10G", form: "SFP+" }, { count: 8, speed: "1G", form: "SFP" }], rj45_wan: [], stackable: false },
      MX450: { sfp_uplinks: [{ count: 2, speed: "10G", form: "SFP+" }], sfp_lan: [{ count: 8, speed: "10G", form: "SFP+" }, { count: 8, speed: "1G", form: "SFP" }], rj45_wan: [], stackable: false }
    },
    MS130: {
      _stackable: false,
      _stack_note: "MS130 does NOT support physical stacking. This is a hard limitation.",
      "MS130-8": { uplinks: [{ count: 2, speed: "1G", form: "SFP" }], stackable: false },
      "MS130-8P": { uplinks: [{ count: 2, speed: "1G", form: "SFP" }], stackable: false },
      "MS130-8P-I": { uplinks: [{ count: 2, speed: "1G", form: "SFP" }], stackable: false },
      "MS130-8X": { uplinks: [{ count: 2, speed: "10G", form: "SFP+" }], stackable: false },
      "MS130-12X": { uplinks: [{ count: 2, speed: "10G", form: "SFP+" }], stackable: false },
      "MS130-24": { uplinks: [{ count: 4, speed: "1G", form: "SFP" }], stackable: false },
      "MS130-24P": { uplinks: [{ count: 4, speed: "1G", form: "SFP" }], stackable: false },
      "MS130-24X": { uplinks: [{ count: 4, speed: "10G", form: "SFP+" }], stackable: false },
      "MS130-48": { uplinks: [{ count: 4, speed: "1G", form: "SFP" }], stackable: false },
      "MS130-48P": { uplinks: [{ count: 4, speed: "1G", form: "SFP" }], stackable: false },
      "MS130-48X": { uplinks: [{ count: 4, speed: "10G", form: "SFP+" }], stackable: false }
    },
    MS150: {
      _stackable: true,
      _stack_type: "100G",
      "MS150-24T-4G": { uplinks: [{ count: 4, speed: "1G", form: "SFP" }], stackable: true, stack_type: "100G" },
      "MS150-24P-4G": { uplinks: [{ count: 4, speed: "1G", form: "SFP" }], stackable: true, stack_type: "100G" },
      "MS150-24T-4X": { uplinks: [{ count: 4, speed: "10G", form: "SFP+" }], stackable: true, stack_type: "100G" },
      "MS150-24P-4X": { uplinks: [{ count: 4, speed: "10G", form: "SFP+" }], stackable: true, stack_type: "100G" },
      "MS150-24MP-4X": { uplinks: [{ count: 4, speed: "10G", form: "SFP+" }], stackable: true, stack_type: "100G" },
      "MS150-48T-4G": { uplinks: [{ count: 4, speed: "1G", form: "SFP" }], stackable: true, stack_type: "100G" },
      "MS150-48LP-4G": { uplinks: [{ count: 4, speed: "1G", form: "SFP" }], stackable: true, stack_type: "100G" },
      "MS150-48FP-4G": { uplinks: [{ count: 4, speed: "1G", form: "SFP" }], stackable: true, stack_type: "100G" },
      "MS150-48T-4X": { uplinks: [{ count: 4, speed: "10G", form: "SFP+" }], stackable: true, stack_type: "100G" },
      "MS150-48LP-4X": { uplinks: [{ count: 4, speed: "10G", form: "SFP+" }], stackable: true, stack_type: "100G" },
      "MS150-48FP-4X": { uplinks: [{ count: 4, speed: "10G", form: "SFP+" }], stackable: true, stack_type: "100G" },
      "MS150-48MP-4X": { uplinks: [{ count: 4, speed: "10G", form: "SFP+" }], stackable: true, stack_type: "100G" }
    },
    MS390: {
      _stackable: true,
      _stack_type: "120G_StackWise480",
      _uplink_type: "modular",
      "MS390-24UX": { uplinks: "modular", stackable: true, stack_type: "120G_StackWise480" },
      "MS390-48UX": { uplinks: "modular", stackable: true, stack_type: "120G_StackWise480" },
      "MS390-48UX2": { uplinks: "modular", stackable: true, stack_type: "120G_StackWise480" }
    },
    MS450: {
      _stackable: true,
      _stack_type: "100G",
      "MS450-12": { uplinks: [{ count: 2, speed: "100G", form: "QSFP28" }], stackable: true, stack_type: "100G" }
    },
    C9300: {
      _stackable: true,
      _stack_type: "STACK-T1",
      _uplink_type: "modular",
      "C9300-24T-M": { uplinks: "modular", stackable: true, stack_type: "STACK-T1" },
      "C9300-24P-M": { uplinks: "modular", stackable: true, stack_type: "STACK-T1" },
      "C9300-24U-M": { uplinks: "modular", stackable: true, stack_type: "STACK-T1" },
      "C9300-24UX-M": { uplinks: "modular", stackable: true, stack_type: "STACK-T1" },
      "C9300-48T-M": { uplinks: "modular", stackable: true, stack_type: "STACK-T1" },
      "C9300-48P-M": { uplinks: "modular", stackable: true, stack_type: "STACK-T1" },
      "C9300-48U-M": { uplinks: "modular", stackable: true, stack_type: "STACK-T1" },
      "C9300-48UXM-M": { uplinks: "modular", stackable: true, stack_type: "STACK-T1" },
      "C9300-48UN-M": { uplinks: "modular", stackable: true, stack_type: "STACK-T1" }
    },
    C9300X: {
      _stackable: true,
      _stack_type: "STACK-T1",
      _uplink_type: "modular",
      "C9300X-12Y-M": { uplinks: "modular", fixed_ports: [{ count: 12, speed: "25G", form: "SFP28" }], stackable: true, stack_type: "STACK-T1" },
      "C9300X-24Y-M": { uplinks: "modular", fixed_ports: [{ count: 24, speed: "25G", form: "SFP28" }], stackable: true, stack_type: "STACK-T1" },
      "C9300X-24HX-M": { uplinks: "modular", stackable: true, stack_type: "STACK-T1" },
      "C9300X-48TX-M": { uplinks: "modular", stackable: true, stack_type: "STACK-T1" },
      "C9300X-48HX-M": { uplinks: "modular", stackable: true, stack_type: "STACK-T1" },
      "C9300X-48HXN-M": { uplinks: "modular", stackable: true, stack_type: "STACK-T1" }
    },
    C9300L: {
      _stackable: true,
      _stack_type: "STACK-T3A",
      _stack_kit_required: "C9300L-STACK-KIT2-M",
      "C9300L-24T-4G-M": { uplinks: [{ count: 4, speed: "1G", form: "SFP" }], stackable: true, stack_type: "STACK-T3A" },
      "C9300L-24P-4G-M": { uplinks: [{ count: 4, speed: "1G", form: "SFP" }], stackable: true, stack_type: "STACK-T3A" },
      "C9300L-24T-4X-M": { uplinks: [{ count: 4, speed: "10G", form: "SFP+" }], stackable: true, stack_type: "STACK-T3A" },
      "C9300L-24P-4X-M": { uplinks: [{ count: 4, speed: "10G", form: "SFP+" }], stackable: true, stack_type: "STACK-T3A" },
      "C9300L-48T-4G-M": { uplinks: [{ count: 4, speed: "1G", form: "SFP" }], stackable: true, stack_type: "STACK-T3A" },
      "C9300L-48P-4G-M": { uplinks: [{ count: 4, speed: "1G", form: "SFP" }], stackable: true, stack_type: "STACK-T3A" },
      "C9300L-48T-4X-M": { uplinks: [{ count: 4, speed: "10G", form: "SFP+" }], stackable: true, stack_type: "STACK-T3A" },
      "C9300L-48P-4X-M": { uplinks: [{ count: 4, speed: "10G", form: "SFP+" }], stackable: true, stack_type: "STACK-T3A" },
      "C9300L-48PF-4X-M": { uplinks: [{ count: 4, speed: "10G", form: "SFP+" }], stackable: true, stack_type: "STACK-T3A" },
      "C9300L-48UXG-4X-M": { uplinks: [{ count: 4, speed: "10G", form: "SFP+" }], stackable: true, stack_type: "STACK-T3A" }
    },
    C9200L: {
      _stackable: true,
      _stack_type: "STACK-T4",
      "C9200L-24T-4G-M": { uplinks: [{ count: 4, speed: "1G", form: "SFP" }], stackable: true, stack_type: "STACK-T4" },
      "C9200L-24P-4G-M": { uplinks: [{ count: 4, speed: "1G", form: "SFP" }], stackable: true, stack_type: "STACK-T4" },
      "C9200L-24T-4X-M": { uplinks: [{ count: 4, speed: "10G", form: "SFP+" }], stackable: true, stack_type: "STACK-T4" },
      "C9200L-24P-4X-M": { uplinks: [{ count: 4, speed: "10G", form: "SFP+" }], stackable: true, stack_type: "STACK-T4" },
      "C9200L-24PXG-4X-M": { uplinks: [{ count: 4, speed: "10G", form: "SFP+" }], stackable: true, stack_type: "STACK-T4" },
      "C9200L-24PXG-2Y-M": { uplinks: [{ count: 2, speed: "25G", form: "SFP28" }], stackable: true, stack_type: "STACK-T4" },
      "C9200L-48T-4G-M": { uplinks: [{ count: 4, speed: "1G", form: "SFP" }], stackable: true, stack_type: "STACK-T4" },
      "C9200L-48P-4G-M": { uplinks: [{ count: 4, speed: "1G", form: "SFP" }], stackable: true, stack_type: "STACK-T4" },
      "C9200L-48PL-4G-M": { uplinks: [{ count: 4, speed: "1G", form: "SFP" }], stackable: true, stack_type: "STACK-T4" },
      "C9200L-48T-4X-M": { uplinks: [{ count: 4, speed: "10G", form: "SFP+" }], stackable: true, stack_type: "STACK-T4" },
      "C9200L-48P-4X-M": { uplinks: [{ count: 4, speed: "10G", form: "SFP+" }], stackable: true, stack_type: "STACK-T4" },
      "C9200L-48PL-4X-M": { uplinks: [{ count: 4, speed: "10G", form: "SFP+" }], stackable: true, stack_type: "STACK-T4" },
      "C9200L-48PXG-4X-M": { uplinks: [{ count: 4, speed: "10G", form: "SFP+" }], stackable: true, stack_type: "STACK-T4" },
      "C9200L-48PXG-2Y-M": { uplinks: [{ count: 2, speed: "25G", form: "SFP28" }], stackable: true, stack_type: "STACK-T4" }
    },
    Z: {
      Z4: { sfp_uplinks: [], rj45_wan: [{ count: 1, speed: "1G" }], stackable: false },
      Z4C: { sfp_uplinks: [], rj45_wan: [{ count: 1, speed: "1G" }], stackable: false },
      Z4X: { sfp_uplinks: [], rj45_wan: [{ count: 1, speed: "2.5G" }], stackable: false },
      Z4CX: { sfp_uplinks: [], rj45_wan: [{ count: 1, speed: "2.5G" }], stackable: false }
    }
  },
  design_rules: {
    matching: [
      "Both ends of a fiber link MUST match: same speed tier, same wavelength, same fiber type (MMF/SMF)",
      "10G SFP+ ports are backward-compatible with 1G SFP modules",
      "25G SFP28 ports are backward-compatible with 10G SFP+ and 1G SFP modules",
      "1G SFP ports do NOT support 10G SFP+ modules (speed mismatch, will not link)"
    ],
    brand_guidance: [
      "Use MA-branded SFPs on Meraki switches for support alignment",
      "Cisco GLC-series SFPs are generally compatible with Meraki but may complicate RMA",
      "MA-SFP modules work fine in Catalyst 9300 series switches",
      "For ER/ZR extended reach (>10km), Cisco-branded modules are the only option"
    ],
    common_mistakes: [
      "MA-SFP-1GB-TX (copper SFP) is NOT supported on MS390, C9300, C9300X, or C9300L",
      "MA-SFP-10GB-LRM is NOT supported on C9300X",
      "C9300-NM-4G module only supports 1G SFP, NOT 10G SFP+ (common ordering mistake)",
      "MS130 is NOT stackable - do not recommend stacking cables",
      "C9300L requires C9300L-STACK-KIT2-M stacking module (sold separately per switch)",
      "C9300/MS390 ship without uplink modules - always ask about uplink needs"
    ],
    sfp_selection_guide: {
      same_rack_10G: { primary: "MA-CBL-TA-1M", alt: "MA-SFP-10GB-SR", reason: "DAC is cheapest for <3m" },
      same_rack_1G: { primary: "MA-SFP-1GB-TX", alt: "MA-SFP-1GB-SX", reason: "Copper SFP uses existing Cat5e/6, but check device compatibility" },
      same_building_MMF_10G: { primary: "MA-SFP-10GB-SR", reason: "Multi-mode, up to 300m OM3 / 400m OM4" },
      same_building_MMF_1G: { primary: "MA-SFP-1GB-SX", reason: "Multi-mode, up to 550m OM2" },
      between_buildings_10G: { primary: "MA-SFP-10GB-LR", reason: "Single-mode, up to 10km" },
      between_buildings_1G: { primary: "MA-SFP-1GB-LX10", reason: "Single-mode, up to 10km" },
      campus_extended_10G: { primary: "MA-SFP-10GB-ER", reason: "Single-mode, up to 40km" },
      metro_long_haul_10G: { primary: "MA-SFP-10GB-ZR", reason: "Single-mode, up to 80km" },
      legacy_fiber_10G: { primary: "MA-SFP-10GB-LRM", reason: "Works with OM1/OM2 legacy fiber up to 220m" }
    }
  }
};

// src/index.js
var ANTHROPIC_API_URL = "https://gateway.ai.cloudflare.com/v1/ec1888c5a0b51dc3eebf6bae13a3922b/stratus-ai-bot/anthropic/v1/messages";
var DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
var staticPrices = prices_default.prices;
// ── Bare-code migrations (2026-08-20) ──
//
// Chris's rule: where a product exists in both forms, always use the non -HW
// one. Meraki has been migrating codes off the -HW suffix; when a family moves,
// the old -HW code keeps a separate Zoho product and loses its storefront row,
// so its cache entry freezes at whatever it last held.
//
// Kept as an explicit override rather than edited into the inlined catalog
// above, so the migration is auditable in one place in this recovered bundle.
// Values verified live against WooProducts and Zoho Products on 2026-08-20.
// Mirrors worker-gchat/src/data/prices.json exactly.
Object.assign(staticPrices, {
  "MS130-8": {"list":1036.65,"price":483,"discount":0.5341,"zoho_product_id":"2570562000396425107","discount_per_unit":553.65,"discount_pct":53},
  "MS130-8-HW": {"list":1036.65,"price":483,"discount":0.5341,"zoho_product_id":"2570562000396425107","discount_per_unit":553.65,"discount_pct":53,"_superseded_by":"MS130-8"},
  "MS130-8P": {"list":1781.73,"price":830,"discount":0.5342,"zoho_product_id":"2570562000388426062","discount_per_unit":951.73,"discount_pct":53},
  "MS130-8P-HW": {"list":1781.73,"price":830,"discount":0.5342,"zoho_product_id":"2570562000388426062","discount_per_unit":951.73,"discount_pct":53,"_superseded_by":"MS130-8P"},
  "MS130-8P-I": {"list":1781.73,"price":830,"discount":0.5342,"zoho_product_id":"2570562000388130266","discount_per_unit":951.73,"discount_pct":53},
  "MS130-8P-I-HW": {"list":1781.73,"price":830,"discount":0.5342,"zoho_product_id":"2570562000388130266","discount_per_unit":951.73,"discount_pct":53,"_superseded_by":"MS130-8P-I"},
  "MS130-8X": {"list":2818.38,"price":1313,"discount":0.5341,"zoho_product_id":"2570562000388092810","discount_per_unit":1505.38,"discount_pct":53},
  "MS130-8X-HW": {"list":2818.38,"price":1313,"discount":0.5341,"zoho_product_id":"2570562000388092810","discount_per_unit":1505.38,"discount_pct":53,"_superseded_by":"MS130-8X"},
  "MS130-12X": {"list":3563.48,"price":1660,"discount":0.5342,"zoho_product_id":"2570562000388240854","discount_per_unit":1903.48,"discount_pct":53},
  "MS130-12X-HW": {"list":3563.48,"price":1660,"discount":0.5342,"zoho_product_id":"2570562000388240854","discount_per_unit":1903.48,"discount_pct":53,"_superseded_by":"MS130-12X"},
  "MS130-24": {"list":2410.21,"price":1123,"discount":0.5341,"zoho_product_id":"2570562000403499128","discount_per_unit":1287.21,"discount_pct":53},
  "MS130-24-HW": {"list":2410.21,"price":1123,"discount":0.5341,"zoho_product_id":"2570562000403499128","discount_per_unit":1287.21,"discount_pct":53,"_superseded_by":"MS130-24"},
  "MS130-24P": {"list":3880.95,"price":1807,"discount":0.5344,"zoho_product_id":"2570562000348083785","discount_per_unit":2073.95,"discount_pct":53},
  "MS130-24P-HW": {"list":3880.95,"price":1807,"discount":0.5344,"zoho_product_id":"2570562000348083785","discount_per_unit":2073.95,"discount_pct":53,"_superseded_by":"MS130-24P"},
  "MS130-24X": {"list":7126.95,"price":3318,"discount":0.5344,"zoho_product_id":"2570562000390025730","discount_per_unit":3808.95,"discount_pct":53},
  "MS130-24X-HW": {"list":7126.95,"price":3318,"discount":0.5344,"zoho_product_id":"2570562000390025730","discount_per_unit":3808.95,"discount_pct":53,"_superseded_by":"MS130-24X"},
  "MS130-48": {"list":4276.17,"price":1991,"discount":0.5344,"zoho_product_id":"2570562000363261166","discount_per_unit":2285.17,"discount_pct":53},
  "MS130-48-HW": {"list":4276.17,"price":1991,"discount":0.5344,"zoho_product_id":"2570562000363261166","discount_per_unit":2285.17,"discount_pct":53,"_superseded_by":"MS130-48"},
  "MS130-48P": {"list":6932.57,"price":3228,"discount":0.5344,"zoho_product_id":"2570562000350111408","discount_per_unit":3704.57,"discount_pct":53},
  "MS130-48P-HW": {"list":6932.57,"price":3228,"discount":0.5344,"zoho_product_id":"2570562000350111408","discount_per_unit":3704.57,"discount_pct":53,"_superseded_by":"MS130-48P"},
  "MS130-48X": {"list":10625.63,"price":4947,"discount":0.5344,"zoho_product_id":"2570562000390014574","discount_per_unit":5678.63,"discount_pct":53},
  "MS130-48X-HW": {"list":10625.63,"price":4947,"discount":0.5344,"zoho_product_id":"2570562000390014574","discount_per_unit":5678.63,"discount_pct":53,"_superseded_by":"MS130-48X"},
  "MS130R-8P": {"list":4534.04,"price":3049,"discount":0.3275,"zoho_product_id":"2570562000405312561","discount_per_unit":1485.04,"discount_pct":33},
  "MS130R-8P-HW": {"list":4534.04,"price":3049,"discount":0.3275,"zoho_product_id":"2570562000405312561","discount_per_unit":1485.04,"discount_pct":33,"_superseded_by":"MS130R-8P"},
  "MX67": {"list":1228.77,"price":572,"discount":0.5345,"zoho_product_id":"2570562000009234263","discount_per_unit":656.77,"discount_pct":53},
  "MX67-HW": {"list":1228.77,"price":572,"discount":0.5345,"zoho_product_id":"2570562000009234263","discount_per_unit":656.77,"discount_pct":53,"_superseded_by":"MX67"},
  "MX67W": {"list":1900.61,"price":994,"discount":0.477,"zoho_product_id":"2570562000399386178","discount_per_unit":906.61,"discount_pct":48},
  "MX67W-HW": {"list":1900.61,"price":994,"discount":0.477,"zoho_product_id":"2570562000399386178","discount_per_unit":906.61,"discount_pct":48,"_superseded_by":"MX67W"},
  "MX68": {"list":1759.18,"price":820,"discount":0.5339,"zoho_product_id":"2570562000010523428","discount_per_unit":939.18,"discount_pct":53},
  "MX68-HW": {"list":1759.18,"price":820,"discount":0.5339,"zoho_product_id":"2570562000010523428","discount_per_unit":939.18,"discount_pct":53,"_superseded_by":"MX68"},
  "MX68W": {"list":2475.21,"price":1295,"discount":0.4768,"zoho_product_id":"2570562000399386198","discount_per_unit":1180.21,"discount_pct":48},
  "MX68W-HW": {"list":2475.21,"price":1295,"discount":0.4768,"zoho_product_id":"2570562000399386198","discount_per_unit":1180.21,"discount_pct":48,"_superseded_by":"MX68W"},
  "MX75": {"list":2839.03,"price":1322,"discount":0.5343,"zoho_product_id":"2570562000353537045","discount_per_unit":1517.03,"discount_pct":53},
  "MX75-HW": {"list":2839.03,"price":1322,"discount":0.5343,"zoho_product_id":"2570562000353537045","discount_per_unit":1517.03,"discount_pct":53,"_superseded_by":"MX75"},
  "MX85": {"list":4411.2,"price":2967,"discount":0.3274,"zoho_product_id":"2570562000388889594","discount_per_unit":1444.2,"discount_pct":33},
  "MX85-HW": {"list":4411.2,"price":2967,"discount":0.3274,"zoho_product_id":"2570562000388889594","discount_per_unit":1444.2,"discount_pct":33,"_superseded_by":"MX85"},
  "MX95": {"list":8831.22,"price":5939,"discount":0.3275,"zoho_product_id":"2570562000357707553","discount_per_unit":2892.22,"discount_pct":33},
  "MX95-HW": {"list":8831.22,"price":5939,"discount":0.3275,"zoho_product_id":"2570562000357707553","discount_per_unit":2892.22,"discount_pct":33,"_superseded_by":"MX95"},
  "MX105": {"list":13251.24,"price":8910,"discount":0.3276,"zoho_product_id":"2570562000362957337","discount_per_unit":4341.24,"discount_pct":33},
  "MX105-HW": {"list":13251.24,"price":8910,"discount":0.3276,"zoho_product_id":"2570562000362957337","discount_per_unit":4341.24,"discount_pct":33,"_superseded_by":"MX105"},
  "MX250": {"list":19616.07,"price":13191,"discount":0.3275,"zoho_product_id":"2570562000362907219","discount_per_unit":6425.07,"discount_pct":33},
  "MX250-HW": {"list":19616.07,"price":13191,"discount":0.3275,"zoho_product_id":"2570562000362907219","discount_per_unit":6425.07,"discount_pct":33,"_superseded_by":"MX250"},
  "MX450": {"list":39240.97,"price":26386,"discount":0.3276,"zoho_product_id":"2570562000362960228","discount_per_unit":12854.97,"discount_pct":33},
  "MX450-HW": {"list":39240.97,"price":26386,"discount":0.3276,"zoho_product_id":"2570562000362960228","discount_per_unit":12854.97,"discount_pct":33,"_superseded_by":"MX450"},
  "MV2": {"list":538.51,"price":276,"discount":0.4875,"zoho_product_id":"2570562000062657390","discount_per_unit":262.51,"discount_pct":49},
  "MV22": {"list":1349.89,"price":908,"discount":0.3274,"zoho_product_id":"2570562000012349690","discount_per_unit":441.89,"discount_pct":33},
  "MV22-HW": {"list":1349.89,"price":908,"discount":0.3274,"zoho_product_id":"2570562000012349690","discount_per_unit":441.89,"discount_pct":33,"_superseded_by":"MV22"},
  "MV32": {"list":1142.05,"price":769,"discount":0.3266,"zoho_product_id":"2570562000016927096","discount_per_unit":373.05,"discount_pct":33},
  "MV53X": {"list":4109.89,"price":2764,"discount":0.3275,"zoho_product_id":"2570562000302894046","discount_per_unit":1345.89,"discount_pct":33},
  "MV72": {"list":1557.72,"price":1048,"discount":0.3272,"zoho_product_id":"2570562000012504179","discount_per_unit":509.72,"discount_pct":33},
  "MV72X": {"list":1765.55,"price":1187,"discount":0.3277,"zoho_product_id":"2570562000029952621","discount_per_unit":578.55,"discount_pct":33},
  "MV84X": {"list":11900.1,"price":8002,"discount":0.3276,"zoho_product_id":"2570562000310730303","discount_per_unit":3898.1,"discount_pct":33}
});

var livePrices = null;
var livePricesCacheTs = 0;
var LIVE_PRICES_CACHE_TTL = 3e5;
function writeMetric(env, { path, model, durationMs, inputTokens, outputTokens, costUsd, personId }) {
  if (!env?.BOT_METRICS) return;
  try {
    env.BOT_METRICS.writeDataPoint({
      blobs: ["webex", path || "unknown", model || "none"],
      doubles: [durationMs || 0, inputTokens || 0, outputTokens || 0, costUsd || 0],
      indexes: [personId || "anonymous"]
    });
  } catch (_) {
  }
}
__name(writeMetric, "writeMetric");
async function logBotUsageToD1(env, {
  personId,
  requestText,
  responsePath,
  model,
  inputTokens,
  outputTokens,
  costUsd,
  durationMs,
  errorMessage,
  responseText,
  toolCallsJson,
  requestedModel,
  executedModel,
  tierPath,
  liveLlmCall,
  tier0Deterministic,
  attempts,
  transientErrors,
  endpoint,
  evalContext,
  reasoningPolicy,
  reasoningDisableSupported,
  reasoningControlJson
}) {
  if (!env?.ANALYTICS_DB) return;
  try {
    if (evalContext?.runId) {
      const resolvedReasoningPolicy = reasoningPolicy || evalContext?.reasoningPolicy || null;
      const resolvedReasoningDisableSupported = reasoningDisableSupported === void 0 ? evalContext?.reasoningDisableSupported ?? null : !!reasoningDisableSupported;
      const resolvedReasoningControlJson = reasoningControlJson ? typeof reasoningControlJson === "string" ? reasoningControlJson : JSON.stringify(reasoningControlJson) : evalContext?.reasoningControlJson || null;
      try {
        await env.ANALYTICS_DB.prepare(
          `INSERT INTO bot_usage_eval (
            eval_run_id, bot, person_id, request_text, response_path, model,
            requested_model, executed_model, tier_path, live_llm_call, tier_0_deterministic,
            attempts, transient_errors, input_tokens, output_tokens, cost_usd, duration_ms,
            error_message, response_text, tool_calls_json, endpoint,
            reasoning_policy, reasoning_disable_supported, reasoning_control_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          evalContext.runId,
          "webex",
          personId || null,
          (requestText || "").substring(0, 2e3),
          responsePath || null,
          model || null,
          requestedModel || evalContext.requestedModel || null,
          executedModel || model || null,
          tierPath || executedModel || model || null,
          liveLlmCall === void 0 ? true : !!liveLlmCall,
          !!tier0Deterministic,
          attempts || 1,
          transientErrors ? (typeof transientErrors === "string" ? transientErrors : JSON.stringify(transientErrors)).substring(0, 2e3) : null,
          inputTokens || 0,
          outputTokens || 0,
          costUsd || 0,
          durationMs || null,
          errorMessage || null,
          responseText ? String(responseText).substring(0, 8e3) : null,
          toolCallsJson ? String(toolCallsJson).substring(0, 8e3) : null,
          endpoint || evalContext.endpoint || null,
          resolvedReasoningPolicy,
          resolvedReasoningDisableSupported,
          resolvedReasoningControlJson ? String(resolvedReasoningControlJson).substring(0, 2e3) : null
        ).run();
        return;
      } catch (schemaErr) {
        if (!/reasoning_policy|reasoning_disable_supported|reasoning_control_json|no such column/i.test(schemaErr.message || "")) {
          throw schemaErr;
        }
      }
      await env.ANALYTICS_DB.prepare(
        `INSERT INTO bot_usage_eval (
          eval_run_id, bot, person_id, request_text, response_path, model,
          requested_model, executed_model, tier_path, live_llm_call, tier_0_deterministic,
          attempts, transient_errors, input_tokens, output_tokens, cost_usd, duration_ms,
          error_message, response_text, tool_calls_json, endpoint
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        evalContext.runId,
        "webex",
        personId || null,
        (requestText || "").substring(0, 2e3),
        responsePath || null,
        model || null,
        requestedModel || evalContext.requestedModel || null,
        executedModel || model || null,
        tierPath || executedModel || model || null,
        liveLlmCall === void 0 ? true : !!liveLlmCall,
        !!tier0Deterministic,
        attempts || 1,
        transientErrors ? (typeof transientErrors === "string" ? transientErrors : JSON.stringify(transientErrors)).substring(0, 2e3) : null,
        inputTokens || 0,
        outputTokens || 0,
        costUsd || 0,
        durationMs || null,
        errorMessage || null,
        responseText ? String(responseText).substring(0, 8e3) : null,
        toolCallsJson ? String(toolCallsJson).substring(0, 8e3) : null,
        endpoint || evalContext.endpoint || null
      ).run();
      return;
    }
    const truncatedReq = (requestText || "").substring(0, 500);
    const truncatedResp = responseText ? String(responseText).substring(0, 4e3) : null;
    await env.ANALYTICS_DB.prepare(
      `INSERT INTO bot_usage (bot, person_id, request_text, response_path, model, input_tokens, output_tokens, cost_usd, duration_ms, error_message, response_text, tool_calls_json)
       VALUES ('webex', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      personId || null,
      truncatedReq,
      responsePath,
      model || null,
      inputTokens || 0,
      outputTokens || 0,
      costUsd || 0,
      durationMs || null,
      errorMessage || null,
      truncatedResp,
      toolCallsJson || null
    ).run();
  } catch (err) {
    console.error("[D1] bot_usage insert error:", err.message);
  }
}
__name(logBotUsageToD1, "logBotUsageToD1");
function makeTraceId() {
  return crypto.randomUUID ? crypto.randomUUID() : `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
__name(makeTraceId, "makeTraceId");
async function ensureTraceTable(db) {
  if (!db || globalThis.__traceTableReady) return;
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS workflow_traces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trace_id TEXT NOT NULL,
      bot TEXT NOT NULL,
      node_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'enter',
      ts_ms REAL NOT NULL,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_traces_created ON workflow_traces(created_at)`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_traces_trace_id ON workflow_traces(trace_id)`).run();
    globalThis.__traceTableReady = true;
  } catch (_) {
    globalThis.__traceTableReady = true;
  }
}
__name(ensureTraceTable, "ensureTraceTable");
function createTracer(env, bot) {
  const traceId = makeTraceId();
  const db = env?.ANALYTICS_DB;
  const steps = [];
  const t0 = Date.now();
  return {
    traceId,
    /** Log a node step. status: 'enter' | 'exit' | 'skip' */
    step(nodeId, status = "enter", meta = null) {
      steps.push({ nodeId, status, tsMs: Date.now() - t0, meta });
    },
    /** Flush all buffered steps to D1 (call in ctx.waitUntil) */
    async flush() {
      if (!db || steps.length === 0) return;
      try {
        await ensureTraceTable(db);
        const stmt = db.prepare(
          `INSERT INTO workflow_traces (trace_id, bot, node_id, status, ts_ms, metadata) VALUES (?, ?, ?, ?, ?, ?)`
        );
        const batch = steps.map(
          (s) => stmt.bind(traceId, bot, s.nodeId, s.status, s.tsMs, s.meta ? JSON.stringify(s.meta) : null)
        );
        await db.batch(batch);
      } catch (err) {
        console.error("[D1] trace flush error:", err.message);
      }
    }
  };
}
__name(createTracer, "createTracer");
async function loadLivePrices(env) {
  const kv = env?.PRICES_KV || env?.CONVERSATION_KV;
  if (!kv || typeof kv.get !== "function") return null;
  const now = Date.now();
  if (livePrices && now - livePricesCacheTs < LIVE_PRICES_CACHE_TTL) {
    return livePrices;
  }
  try {
    const stored = await kv.get("prices_live", "json");
    if (stored?.prices) {
      livePrices = stored.prices;
      livePricesCacheTs = now;
      console.log(`[PRICES] Loaded live prices from KV (refreshed: ${stored.refreshedAt}, ${stored.stats?.updated || "?"} updated)`);
      return livePrices;
    }
  } catch (err) {
    console.error(`[PRICES] KV read error: ${err.message}`);
  }
  return null;
}
__name(loadLivePrices, "loadLivePrices");
var prices = new Proxy(staticPrices, {
  get(target, prop) {
    if (livePrices && livePrices[prop]) {
      if (target[prop] && target[prop]._superseded_by) return target[prop];
      return livePrices[prop];
    }
    return target[prop];
  },
  has(target, prop) {
    if (livePrices && prop in livePrices) return true;
    return prop in target;
  }
});
function canonicalDirectMsLicenseSku(modelToken, term) {
  const model = String(modelToken || "").toUpperCase();
  const suffix = `${term}Y`;
  if (/^MS130-CMPTA$/.test(model)) return `LIC-MS130-CMPTA-${suffix}`;
  if (/^MS130-CMPT$/.test(model)) return `LIC-MS130-CMPT-${suffix}`;
  const ms130Adv = model.match(/^MS130-(24|48)A$/);
  if (ms130Adv) return `LIC-MS130-${ms130Adv[1]}A-${suffix}`;
  const ms150Adv = model.match(/^MS150-(24|48)A$/);
  if (ms150Adv) return `LIC-MS150-${ms150Adv[1]}A-${suffix}`;
  const ms390Tiered = model.match(/^MS390-(24|48)(A|E)$/);
  if (ms390Tiered) return `LIC-MS390-${ms390Tiered[1]}${ms390Tiered[2]}-${suffix}`;
  return null;
}
__name(canonicalDirectMsLicenseSku, "canonicalDirectMsLicenseSku");
var MS390_LICENSE_MODEL_TOKENS = /* @__PURE__ */ new Set([
  "MS390-24",
  "MS390-24P",
  "MS390-24U",
  "MS390-24UX",
  "MS390-48",
  "MS390-48P",
  "MS390-48U",
  "MS390-48UX",
  "MS390-48UX2"
]);
function requiresMsLicenseModelInputValidation(modelToken) {
  const upper = String(modelToken || "").toUpperCase();
  return /^(MS130R|MS130|MS150|MS390)-/.test(upper);
}
__name(requiresMsLicenseModelInputValidation, "requiresMsLicenseModelInputValidation");
function hasKnownMsLicenseModelInput(modelToken) {
  const upper = String(modelToken || "").toUpperCase();
  if (MS390_LICENSE_MODEL_TOKENS.has(upper)) return true;
  const suffixed = applySuffix(upper);
  return Boolean(prices[upper] || prices[suffixed]);
}
__name(hasKnownMsLicenseModelInput, "hasKnownMsLicenseModelInput");
function normalizeDirectLicenseSku(sku) {
  const upper = String(sku || "").trim().toUpperCase();
  const smeDirect = upper.match(/^LIC-SME(?:-(\d+)Y(R)?)?$/i);
  if (smeDirect) {
    return { sku: smeReplacementSku(smeDirect[1] || 3), note: SME_EOL_FLAG };
  }
  const vmxDirect = upper.match(/^LIC-VMX-(S|M|L|XL)-(\d+)Y(R)?$/);
  if (vmxDirect) {
    const swapped = eolPick(`LIC-VMX-${vmxDirect[1]}-ENT`, vmxDirect[2], "Y");
    return { sku: swapped, note: `vMX licenses now require an edition \u2014 quoted ${swapped} (ENT). Say "SEC" if the network runs Advanced Security.` };
  }
  if (/^LIC-VMX\d/.test(upper)) {
    return { sku: upper, invalid: true, note: `${upper} is a retired vMX license and can't be sized automatically \u2014 pick a LIC-VMX-{S|M|L|XL}-{ENT|SEC} equivalent.` };
  }
  if (INSIGHT_RE.test(upper)) {
    return { sku: upper, invalid: true, note: `${upper} \u2014 Meraki Insight is retired. Its features moved to SD-WAN Plus: upgrade the MX license from -SEC- to -SDW- instead.` };
  }
  if (prices[upper]) return { sku: upper };
  const msDirect = upper.match(/^LIC-(MS\d{3}-[A-Z0-9-]+)-([135])Y(?:R)?$/);
  if (msDirect) {
    const [, modelToken, term] = msDirect;
    const directCanonical = canonicalDirectMsLicenseSku(modelToken, term);
    if (directCanonical && prices[directCanonical]) {
      return directCanonical === upper ? { sku: upper } : {
        sku: directCanonical,
        note: `${upper} is not a valid switch license SKU; using ${directCanonical}.`
      };
    }
    if (requiresMsLicenseModelInputValidation(modelToken) && !hasKnownMsLicenseModelInput(modelToken)) {
      return {
        sku: upper,
        invalid: true,
        note: `${upper} is not a recognized switch license SKU.`
      };
    }
    const licenses = getLicenseSkus(modelToken);
    const canonical = licenses?.find((l) => l.term === `${term}Y`)?.sku || null;
    if (canonical && prices[canonical]) {
      return {
        sku: canonical,
        note: `${upper} is not a valid switch license SKU; using ${canonical}.`
      };
    }
    return {
      sku: upper,
      invalid: true,
      note: `${upper} is not a recognized switch license SKU.`
    };
  }
  return { sku: upper };
}
__name(normalizeDirectLicenseSku, "normalizeDirectLicenseSku");
function normalizeParsedDirectLicenses(parsed) {
  const notes = [];
  const invalidSkus = [];
  const addNote = /* @__PURE__ */ __name((note) => {
    if (note && !notes.includes(note)) notes.push(note);
  }, "addNote");
  if (Array.isArray(parsed.directLicenseList)) {
    const swapped = applyEolSwaps(parsed.directLicenseList);
    swapped.notes.forEach(addNote);
    parsed.directLicenseList = swapped.lines;
    parsed.directLicenseList = parsed.directLicenseList.map((item) => {
      const normalized = normalizeDirectLicenseSku(item.sku);
      addNote(normalized.note);
      if (normalized.invalid) invalidSkus.push(normalized.sku);
      return { ...item, sku: normalized.sku };
    });
  }
  if (parsed.directLicense) {
    const normalized = normalizeDirectLicenseSku(parsed.directLicense.sku);
    addNote(normalized.note);
    if (normalized.invalid) invalidSkus.push(normalized.sku);
    parsed.directLicense = { ...parsed.directLicense, sku: normalized.sku };
  }
  if (notes.length > 0) {
    parsed.clarificationNote = [parsed.clarificationNote, ...notes].filter(Boolean).join(" ");
  }
  return invalidSkus;
}
__name(normalizeParsedDirectLicenses, "normalizeParsedDirectLicenses");
function hasMsAdvancedTierIntent(text) {
  const upper = String(text || "").toUpperCase();
  if (!/\b(MS130|MS150|MS390|C9\d{3}|C9200L|C9300)\b/.test(upper)) return false;
  if (/\bADVANCED\s+SECURITY\b/.test(upper)) return false;
  return /\b(ADVANCED|ADV)\s*(LICENSE|LICENSING|LICENCE|LIC|FEATURES?|TIER)?\b/.test(upper) || /\bADAPTIVE\s+POLICY\b/.test(upper);
}
__name(hasMsAdvancedTierIntent, "hasMsAdvancedTierIntent");
function normalizeRequestedTier(rawTier, rawText = "") {
  const raw = String(rawTier || "").toUpperCase().replace(/\s+/g, "").replace(/^SD-WAN$/, "SDW");
  if (["SEC", "ENT", "SDW"].includes(raw)) return raw;
  if (["A", "ADV", "ADVANCED"].includes(raw)) return hasMsAdvancedTierIntent(rawText) ? "A" : null;
  return hasMsAdvancedTierIntent(rawText) ? "A" : null;
}
__name(normalizeRequestedTier, "normalizeRequestedTier");
function preserveMsAdvancedTier(parsed, rawText) {
  if (parsed && !parsed.requestedTier && hasMsAdvancedTierIntent(rawText)) {
    parsed.requestedTier = "A";
  }
  return parsed;
}
__name(preserveMsAdvancedTier, "preserveMsAdvancedTier");
function rewriteSkuTerm(sku, newTerm) {
  if (!sku || ![1, 3, 5].includes(Number(newTerm))) return null;
  const s = String(sku).toUpperCase();
  const m = s.match(/-([135])(YR|Y-S\d+|Y)$/);
  if (!m) return null;
  return s.replace(/-([135])(YR|Y-S\d+|Y)$/, `-${newTerm}$2`);
}
__name(rewriteSkuTerm, "rewriteSkuTerm");
function canRewriteDirectLicenseListForAllTerms(list) {
  if (!Array.isArray(list) || list.length === 0) return false;
  return [1, 3, 5].every((term) => canRewriteDirectLicenseListForTerm(list, term));
}
__name(canRewriteDirectLicenseListForAllTerms, "canRewriteDirectLicenseListForAllTerms");
function directLicenseSkuForTerm(sku, term) {
  if (!sku || !String(sku).toUpperCase().startsWith("LIC-")) return null;
  const key = `${Number(term)}Y`;
  const siblings = licenseTermSiblings(sku);
  if (siblings) return siblings[key] || null;
  const rewritten = rewriteSkuTerm(sku, term);
  return rewritten && prices[rewritten] ? rewritten : null;
}
__name(directLicenseSkuForTerm, "directLicenseSkuForTerm");
function canRewriteDirectLicenseListForTerm(list, term) {
  if (!Array.isArray(list) || list.length === 0 || ![1, 3, 5].includes(Number(term))) return false;
  return list.every(({ sku }) => !!directLicenseSkuForTerm(sku, term));
}
__name(canRewriteDirectLicenseListForTerm, "canRewriteDirectLicenseListForTerm");
function rewriteDirectLicenseListForTerm(list, term) {
  return list.map(({ sku, qty }) => {
    const rewritten = directLicenseSkuForTerm(sku, term);
    return { sku: rewritten || sku, qty };
  });
}
__name(rewriteDirectLicenseListForTerm, "rewriteDirectLicenseListForTerm");
function shouldPreserveTypedDirectLicenseTerm(rawText, sku) {
  void rawText;
  void sku;
  return false;
}
__name(shouldPreserveTypedDirectLicenseTerm, "shouldPreserveTypedDirectLicenseTerm");
var catalog = auto_catalog_default;
var specs = specs_default;
var EOL_PRODUCTS = catalog._EOL_PRODUCTS || {};
var EOL_REPLACEMENTS = catalog._EOL_REPLACEMENTS || {};
var EOL_DATES = catalog._EOL_DATES || {};
var COMMON_MISTAKES = catalog._COMMON_MISTAKES || {};
var PASSTHROUGH = new Set(catalog._PASSTHROUGH || []);
var DATASHEET_URLS = {
  MX67: "https://documentation.meraki.com/SASE_and_SD-WAN/MX/Product_Information/Overviews_and_Datasheets/MX67_and_MX68_Datasheet",
  MX67W: "https://documentation.meraki.com/SASE_and_SD-WAN/MX/Product_Information/Overviews_and_Datasheets/MX67_and_MX68_Datasheet",
  MX67C: "https://documentation.meraki.com/SASE_and_SD-WAN/MX/Product_Information/Overviews_and_Datasheets/MX67_and_MX68_Datasheet",
  MX68: "https://documentation.meraki.com/SASE_and_SD-WAN/MX/Product_Information/Overviews_and_Datasheets/MX67_and_MX68_Datasheet",
  MX68W: "https://documentation.meraki.com/SASE_and_SD-WAN/MX/Product_Information/Overviews_and_Datasheets/MX67_and_MX68_Datasheet",
  MX68CW: "https://documentation.meraki.com/SASE_and_SD-WAN/MX/Product_Information/Overviews_and_Datasheets/MX67_and_MX68_Datasheet",
  MX75: "https://documentation.meraki.com/MX/MX_Overviews_and_Specifications/MX75_Datasheet",
  MX85: "https://documentation.meraki.com/SASE_and_SD-WAN/MX/Product_Information/Overviews_and_Datasheets/MX85_Datasheet",
  MX95: "https://documentation.meraki.com/SASE_and_SD-WAN/MX/Product_Information/Overviews_and_Datasheets/MX95%2F%2F105_Datasheet",
  MX105: "https://documentation.meraki.com/SASE_and_SD-WAN/MX/Product_Information/Overviews_and_Datasheets/MX95%2F%2F105_Datasheet",
  MX250: "https://documentation.meraki.com/SASE_and_SD-WAN/MX/Product_Information/Overviews_and_Datasheets/MX250_Datasheet",
  MX450: "https://documentation.meraki.com/SASE_and_SD-WAN/MX/Product_Information/Overviews_and_Datasheets/MX450_Datasheet",
  "C8111-G2-MX": "https://documentation.meraki.com/SASE_and_SD-WAN/MX/Product_Information/Overviews_and_Datasheets/C8111-G2-MX_and_C8121-G2-MX_Data_Sheet",
  "C8121-G2-MX": "https://documentation.meraki.com/SASE_and_SD-WAN/MX/Product_Information/Overviews_and_Datasheets/C8111-G2-MX_and_C8121-G2-MX_Data_Sheet",
  "C8455-G2-MX": "https://documentation.meraki.com/SASE_and_SD-WAN/MX/Product_Information/Overviews_and_Datasheets/C8455-G2-MX_Data_Sheet",
  MR28: "https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/MR28_Datasheet",
  MR36: "https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/MR36_Datasheet",
  MR36H: "https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/MR36H_Datasheet",
  MR44: "https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/MR44_Datasheet",
  MR46: "https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/MR46_Datasheet",
  MR46E: "https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/MR46E_Datasheet",
  MR57: "https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/MR57_Datasheet",
  MR76: "https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/MR76_Datasheet",
  MR78: "https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/MR78_Datasheet",
  MR86: "https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/MR86_Datasheet",
  CW9162I: "https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/CW9162_Datasheet",
  CW9163E: "https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/CW9163E_Datasheet",
  CW9164I: "https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/CW9164_Datasheet",
  CW9166I: "https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/CW9166_Datasheet",
  CW9166D1: "https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/CW9166_Datasheet",
  CW9171I: "https://www.cisco.com/c/en/us/products/collateral/wireless/catalyst-9100ax-access-points/wireless-9171-series-acc-point-ds.html",
  CW9172I: "https://www.cisco.com/c/en/us/products/collateral/wireless/catalyst-9100ax-access-points/wireless-9172-series-access-points-ds.html",
  CW9172H: "https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/CW9172H_Datasheet",
  CW9174I: "https://www.cisco.com/c/en/us/products/collateral/wireless/catalyst-9100ax-access-points/wireless-9174-series-access-points-ds.html",
  CW9176I: "https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/CW9176I_%2F%2F_CW9176D1_Datasheet",
  CW9176D1: "https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/CW9176I_%2F%2F_CW9176D1_Datasheet",
  CW9178I: "https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/CW9178I_Datasheet",
  CW9179F: "https://www.cisco.com/site/us/en/products/collateral/networking/wireless/access-points/catalyst-9100-series/wireless-9179f-access-point-ds.html",
  MS130: "https://documentation.meraki.com/Switching/MS_-_Switches/Product_Information/Overviews_and_Datasheets/MS130_Datasheet",
  MS150: "https://documentation.meraki.com/Switching/MS_-_Switches/Product_Information/Overviews_and_Datasheets/MS150_Datasheet",
  MS390: "https://documentation.meraki.com/Switching/MS_-_Switches/Product_Information/Overviews_and_Datasheets/MS390_Datasheet",
  MS450: "https://documentation.meraki.com/Switching/MS_-_Switches/Product_Information/Overviews_and_Datasheets/MS450_Overview_and_Specifications",
  C9300: "https://documentation.meraki.com/Switching/Cloud_Management_with_IOS_XE/Product_Information/Overviews_and_Datasheets/Catalyst_9300-M_Datasheet",
  C9300X: "https://documentation.meraki.com/Switching/Cloud_Management_with_IOS_XE/Product_Information/Overviews_and_Datasheets/Catalyst_9300X-M_Datasheet",
  C9300L: "https://documentation.meraki.com/Switching/Cloud_Management_with_IOS_XE/Product_Information/Overviews_and_Datasheets/Catalyst_9300L-M_Datasheet",
  C9200L: "https://documentation.meraki.com/Switching/Cloud_Management_with_IOS_XE/Product_Information/Overviews_and_Datasheets/Catalyst_9200L-M_Datasheet",
  MV13: "https://documentation.meraki.com/IoT/MV_-_Smart_Cameras/Product_Information/MV_Overviews_and_Datasheets/MV13_Datasheet",
  MV22X: "https://documentation.meraki.com/IoT/MV_-_Smart_Cameras/Product_Information/MV_Overviews_and_Datasheets/Second_Generation_MV_Cameras:_Overview_and_Specifications",
  MV23X: "https://documentation.meraki.com/IoT/MV_-_Smart_Cameras/Product_Information/MV_Overviews_and_Datasheets/MV23_Series_Datasheet",
  MV33: "https://documentation.meraki.com/IoT/MV_-_Smart_Cameras/Product_Information/MV_Overviews_and_Datasheets/MV33_Datasheet",
  MV53X: "https://documentation.meraki.com/IoT/MV_-_Smart_Cameras/Product_Information/MV_Overviews_and_Datasheets/MV53X_Datasheet",
  MV63: "https://documentation.meraki.com/IoT/MV_-_Smart_Cameras/Product_Information/MV_Overviews_and_Datasheets/Third_Generation_MV_Cameras:_Overview_and_Specifications",
  MV73X: "https://documentation.meraki.com/IoT/MV_-_Smart_Cameras/Product_Information/MV_Overviews_and_Datasheets/MV73_Series_Datasheet",
  MV84X: "https://documentation.meraki.com/IoT/MV_-_Smart_Cameras/Product_Information/MV_Overviews_and_Datasheets/MV84X_Datasheet",
  MV93: "https://documentation.meraki.com/IoT/MV_-_Smart_Cameras/Product_Information/MV_Overviews_and_Datasheets/MV93_Series_Datasheet",
  Z4: "https://documentation.meraki.com/SASE_and_SD-WAN/Z-Series_Teleworker_Gateways/Product_Information/Z4_Datasheet",
  MG21: "https://documentation.meraki.com/SASE_and_SD-WAN/Cellular/Product_Information/Overviews_and_Datasheets",
  MG41: "https://documentation.meraki.com/SASE_and_SD-WAN/Cellular/Product_Information/MG_Antenna_Datasheets/MG41_Internal_Antenna_Datasheet",
  MG51: "https://documentation.meraki.com/SASE_and_SD-WAN/Cellular/Product_Information/MG_Antenna_Datasheets/MG51_Internal_Antenna_Datasheet",
  MG52: "https://documentation.meraki.com/SASE_and_SD-WAN/Cellular/Product_Information/MG_Antenna_Datasheets/MG52_Internal_Antenna_Datasheet",
  MT10: "https://documentation.meraki.com/IoT/MT_-_Sensors/Product_Information/MT_Overviews_and_Datasheets/MT10_Datasheet_-_Temperature_and_Humidity",
  MT14: "https://documentation.meraki.com/MT/MT_Datasheets/MT14_Datasheet_-_Indoor_Air_Quality_Monitor",
  MT20: "https://documentation.meraki.com/MT/MT_Datasheets/MT20_Datasheet_-_Open%2F%2FClose_Detection",
  MT40: "https://documentation.meraki.com/MT/MT_Datasheets/MT40_Datasheet_-_Smart_Power_Controller"
};
function getDatasheetKey(model) {
  const upper = model.toUpperCase();
  if (DATASHEET_URLS[upper]) return upper;
  const mxMatch = upper.match(/^(MX\d+[A-Z]*)/);
  if (mxMatch && DATASHEET_URLS[mxMatch[1]]) return mxMatch[1];
  const mrMatch = upper.match(/^(MR\d+[A-Z]*)/);
  if (mrMatch && DATASHEET_URLS[mrMatch[1]]) return mrMatch[1];
  const mgmtMatch = upper.match(/^(M[GT]\d+)/);
  if (mgmtMatch && DATASHEET_URLS[mgmtMatch[1]]) return mgmtMatch[1];
  const mvMatch = upper.match(/^(MV\d+[A-Z]*)/);
  if (mvMatch && DATASHEET_URLS[mvMatch[1]]) return mvMatch[1];
  const cwMatch = upper.match(/^(CW\d+[A-Z]*\d*)/);
  if (cwMatch && DATASHEET_URLS[cwMatch[1]]) return cwMatch[1];
  const msMatch = upper.match(/^(MS\d+)/);
  if (msMatch && DATASHEET_URLS[msMatch[1]]) return msMatch[1];
  if (upper.startsWith("C8111-G2-MX")) return "C8111-G2-MX";
  if (upper.startsWith("C8121-G2-MX")) return "C8121-G2-MX";
  if (upper.startsWith("C8455-G2-MX")) return "C8455-G2-MX";
  if (upper.startsWith("C9300X")) return "C9300X";
  if (upper.startsWith("C9300L")) return "C9300L";
  if (upper.startsWith("C9300")) return "C9300";
  if (upper.startsWith("C9200")) return "C9200L";
  if (/^Z4/.test(upper)) return "Z4";
  return null;
}
__name(getDatasheetKey, "getDatasheetKey");
var datasheetCache = /* @__PURE__ */ new Map();
var CACHE_TTL = 5 * 60 * 1e3;
var DATASHEET_FETCH_TIMEOUT_MS = 1e4;
var DATASHEET_TEXT_MAX_CHARS = 6e3;
var MAX_DATASHEET_FETCH_MODELS = 5;
async function fetchDatasheet(url) {
  const now = Date.now();
  const cached = datasheetCache.get(url);
  if (cached && now - cached.time < CACHE_TTL) return cached.text;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "StratusAI-Bot/1.0 (spec-lookup)" },
      signal: AbortSignal.timeout(DATASHEET_FETCH_TIMEOUT_MS)
    });
    if (!res.ok) return null;
    const html = await res.text();
    const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "").replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "").replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#\d+;/g, "").replace(/\s+/g, " ").trim();
    if (/page not found|404\s*-\s*page/i.test(text.slice(0, 500))) return null;
    const truncated = text.length > DATASHEET_TEXT_MAX_CHARS ? text.slice(0, DATASHEET_TEXT_MAX_CHARS) + "..." : text;
    datasheetCache.set(url, { text: truncated, time: now });
    return truncated;
  } catch (e) {
    console.error(`Datasheet fetch failed for ${url}:`, e.message);
    return null;
  }
}
__name(fetchDatasheet, "fetchDatasheet");
function getStaticSpecsContext(message) {
  const upper = message.toUpperCase();
  const modelPatterns = [
    /\b(MX\d+[A-Z]*)/g,
    /\b(MR\d+[A-Z]*)/g,
    /\b(CW\d+[A-Z]*\d*)/g,
    /\b(MS\d{3}[R]?(?:-\d+[A-Z]*(?:-\d+[A-Z])?)?)/g,
    /\b(MV\d+[A-Z]*)/g,
    /\b(MT\d+)/g,
    /\b(MG\d+[A-Z]*)/g,
    /\b(Z4[A-Z]*)/g,
    /\b(C[89]\d{3}(?:-[A-Z0-9]+)*)/g
  ];
  const found = [];
  for (const pat of modelPatterns) {
    let m;
    while ((m = pat.exec(upper)) !== null) {
      const model = m[1];
      for (const [family, familyData] of Object.entries(specs)) {
        if (family.startsWith("_")) continue;
        if (familyData[model]) {
          found.push({ model, specs: familyData[model] });
        }
        const baseMatch = model.match(/^(MS\d{3}|MX\d+|MR\d+|MV\d+|MG\d+|MT\d+|CW\d+[A-Z]*\d*|Z4|C[89]\d{3}(?:-[A-Z0-9]+)*)/);
        if (baseMatch && familyData[baseMatch[1]] && !found.some((f) => f.model === baseMatch[1])) {
          found.push({ model: baseMatch[1], specs: familyData[baseMatch[1]] });
        }
        const familyStem = baseMatch ? baseMatch[1] : model;
        const familyMatches = family === familyStem || family === `${familyStem}-M` || family.startsWith(`${familyStem}-`) || family.startsWith(`${familyStem}`);
        if (familyMatches && familyData._family && !found.some((f) => f.model === family)) {
          const variantList = Object.keys(familyData).filter((k) => !k.startsWith("_"));
          found.push({
            model: family,
            specs: {
              family: familyData._family,
              variants: variantList,
              _stacking: familyData._stacking || void 0
            }
          });
        }
      }
    }
  }
  if (found.length === 0) return null;
  const seen = /* @__PURE__ */ new Set();
  const unique = found.filter((f) => {
    if (seen.has(f.model)) return false;
    seen.add(f.model);
    return true;
  });
  let context = "## PRODUCT SPECS (from specs.json \u2014 AUTHORITATIVE SOURCE)\n";
  context += "CRITICAL: Use ONLY these specs when answering. Do NOT supplement with training data. These specs OVERRIDE any conflicting information in conversation history \u2014 if prior messages contain different numbers, they were wrong and these are correct.\n";
  context += `If the user asks about a spec not listed here, say "I don't have that specific spec cached \u2014 want me to pull the latest datasheet to confirm?"
`;
  context += 'FORMATTING: This renders in Webex, which does NOT render pipe-delimited markdown tables. NEVER output rows like "| col | col |" \u2014 they render as literal pipe characters. For multi-model comparisons, use grouped bullets per model (e.g. "**MX95** \xB7 FW: 3 Gbps \xB7 VPN: 2.5 Gbps \xB7 500 users") or a stacked list with bolded model names as headers.\n';
  for (const { model, specs: s } of unique) {
    context += `${model}: ${JSON.stringify(s)}
`;
  }
  return { text: context, models: unique.map((u) => u.model) };
}
__name(getStaticSpecsContext, "getStaticSpecsContext");
function extractDatasheetKeys(message) {
  const upper = String(message || "").toUpperCase();
  const modelPatterns = [
    /\b(MX\d+[A-Z]*)/g,
    /\b(MR\d+[A-Z]*)/g,
    /\b(CW\d+[A-Z]*\d*)/g,
    /\b(MS\d{3}[R]?(?:-\d+[A-Z]*(?:-\d+[A-Z])?)?)/g,
    /\b(MV\d+[A-Z]*)/g,
    /\b(MT\d+)/g,
    /\b(MG\d+[A-Z]*)/g,
    /\b(Z4[A-Z]*)/g,
    /\b(C[89]\d{3}(?:-[A-Z0-9]+)*)/g
  ];
  const models = /* @__PURE__ */ new Set();
  for (const pat of modelPatterns) {
    let m;
    while ((m = pat.exec(upper)) !== null) {
      const key = getDatasheetKey(m[1]);
      if (key) models.add(key);
    }
  }
  return [...models].slice(0, MAX_DATASHEET_FETCH_MODELS);
}
__name(extractDatasheetKeys, "extractDatasheetKeys");
async function getRelevantDatasheetContext(message) {
  const keys = extractDatasheetKeys(String(message || ""));
  if (keys.length === 0) return null;
  const uniqueUrls = [...new Set(keys.map((k) => DATASHEET_URLS[k]))];
  const fetches = uniqueUrls.map(async (url, idx) => {
    const text = await fetchDatasheet(url);
    return text ? { idx, url, body: `[Datasheet: ${url}]
${text}` } : null;
  });
  const fetchRows = (await Promise.all(fetches)).filter(Boolean);
  if (fetchRows.length === 0) return null;
  const results = fetchRows.map((r) => r.body);
  const fetchedUrls = fetchRows.map((r) => r.url);
  const staticSpecs = [];
  for (const key of keys) {
    for (const family of Object.keys(specs)) {
      if (family.startsWith("_")) continue;
      const familyData = specs[family];
      if (familyData[key]) {
        staticSpecs.push(`${key}: ${JSON.stringify(familyData[key])}`);
      }
    }
  }
  let context = `## LIVE DATASHEET CONTENT (use this as your primary source for specs)
FORMATTING: This renders in Webex \u2014 NEVER output pipe-delimited markdown tables ("| col | col |"). They render as literal pipes. Use stacked bolded model headers followed by spec bullets per model.

REQUESTED/FETCHED MODELS: ${keys.join(", ")}
SOURCE URL RULE: Quote source URLs exactly from the [Datasheet: ...] labels below. Do NOT rewrite, shorten, infer, or invent datasheet URLs.
SCOPE RULE: Answer only for the requested/fetched models above. Do NOT add models from conversation history unless the current user explicitly asked for them.

` + results.join("\n\n");
  if (staticSpecs.length > 0) {
    context += "\n\n## CACHED SPECS (fallback if datasheet content is unclear)\n" + staticSpecs.join("\n");
  }
  return { text: context, models: keys, urls: fetchedUrls };
}
__name(getRelevantDatasheetContext, "getRelevantDatasheetContext");
function isDatasheetRetryFollowup(message) {
  return /\b(try\s+again|retry|again|try\s+that\s+again|do\s+it\s+again|please\s+(?:try|do|fetch|pull|retry)|you\s+(?:can|do)\s+(?:do|have|fetch|pull|browse)|fetch\s+it|pull\s+it|do\s+it)\b/i.test(String(message || ""));
}
__name(isDatasheetRetryFollowup, "isDatasheetRetryFollowup");
function looksLikeRecentDatasheetTurn(content) {
  return /Claude Sonnet|Live datasheet|LIVE DATASHEET CONTENT|datasheet|specs?\b|cached specs|browse|fetch|Source URL/i.test(String(content || ""));
}
__name(looksLikeRecentDatasheetTurn, "looksLikeRecentDatasheetTurn");
async function getRecentDatasheetRequestContext(history) {
  const recentTurns = [...history || []].reverse().slice(0, 8);
  const explicitUserRequests = recentTurns.filter(
    (turn) => turn && turn.role === "user" && /\b(datasheets?|spec\s+sheet|live\s+web\s+fetch|fetch|pull|scan|read|get)\b/i.test(String(turn.content || "")) && extractDatasheetKeys(String(turn.content || "")).length > 0
  );
  for (const turn of explicitUserRequests) {
    const ctx = await getRelevantDatasheetContext(turn.content);
    if (ctx) return ctx;
  }
  for (const role of ["user", "assistant"]) {
    for (const turn of recentTurns) {
      if (!turn || turn.role !== role) continue;
      const ctx = await getRelevantDatasheetContext(turn.content);
      if (ctx) return ctx;
    }
  }
  return null;
}
__name(getRecentDatasheetRequestContext, "getRecentDatasheetRequestContext");
var VALID_SKUS = /* @__PURE__ */ new Set();
for (const [key, value] of Object.entries(catalog)) {
  if (key.startsWith("_")) continue;
  if (Array.isArray(value)) {
    for (const sku of value) VALID_SKUS.add(sku.toUpperCase());
  }
}
for (const sku of PASSTHROUGH) VALID_SKUS.add(sku.toUpperCase());
var MAX_HISTORY = 10;
var HISTORY_TTL_SECONDS = 30 * 60;
async function getHistory(kv, personId) {
  if (!kv) return [];
  try {
    const data = await kv.get(`conv:${personId}`, "json");
    if (!data) return [];
    if (Array.isArray(data)) return data;
    return data.messages || [];
  } catch {
    return [];
  }
}
__name(getHistory, "getHistory");
async function addToHistory(kv, personId, role, content) {
  if (!kv) return;
  try {
    let storable = content;
    if (Array.isArray(content)) {
      const textParts = content.filter((c) => c.type === "text").map((c) => c.text);
      const hasImage = content.some((c) => c.type === "image");
      storable = (hasImage ? "[User sent an image] " : "") + textParts.join(" ");
    }
    let data = await kv.get(`conv:${personId}`, "json");
    if (!data) {
      data = { messages: [] };
    } else if (Array.isArray(data)) {
      data = { messages: data };
    } else if (!Array.isArray(data.messages)) {
      data = { messages: [] };
    }
    data.messages.push({ role, content: storable });
    while (data.messages.length > MAX_HISTORY) {
      data.messages.shift();
    }
    await kv.put(`conv:${personId}`, JSON.stringify(data), {
      expirationTtl: HISTORY_TTL_SECONDS
    });
  } catch (e) {
    console.error("KV write error:", e.message);
  }
}
__name(addToHistory, "addToHistory");
var cachedBotPersonId = null;
async function getBotPersonId(token) {
  if (cachedBotPersonId) return cachedBotPersonId;
  const res = await fetch("https://webexapis.com/v1/people/me", {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[WEBEX] getBotPersonId failed: ${res.status} ${res.statusText} \u2014 ${body.substring(0, 200)}`);
    return null;
  }
  const data = await res.json();
  cachedBotPersonId = data.id;
  return cachedBotPersonId;
}
__name(getBotPersonId, "getBotPersonId");
async function getMessage(messageId, token) {
  const res = await fetch(`https://webexapis.com/v1/messages/${messageId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[WEBEX] getMessage failed: ${res.status} ${res.statusText} \u2014 ${body.substring(0, 200)}`);
    return null;
  }
  return res.json();
}
__name(getMessage, "getMessage");
async function downloadWebexFile(fileUrl, token) {
  try {
    const res = await fetch(fileUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/png";
    const arrayBuffer = await res.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return { base64, mediaType: contentType.split(";")[0].trim() };
  } catch (err) {
    console.error("File download error:", err.message);
    return null;
  }
}
__name(downloadWebexFile, "downloadWebexFile");
var CF_CLASSIFIER_PROMPT_V3 = `You are an intent classifier for a Cisco/Meraki quoting bot. Output a single JSON object \u2014 no prose, no markdown.

SCHEMA:
{"intent":"quote|revise|price_lookup|dashboard_parse|product_info|escalate|conversation","confidence":0.0-1.0,"clarify":{"needed":false,"question":""},"items":[{"product":"...","qty":1,"intent":"hardware|license|normal"}],"modifiers":{"term_years":null,"tier":null,"show_pricing":false,"all_terms":false,"separate_quotes":false},"revision":{"action":null,"target_sku":null,"add_items":[],"new_term":null,"new_tier":null,"new_qty":null,"hw_lic_toggle":null},"reference":{"is_pronoun_ref":false,"option_ref":null,"resolve_from_history":false},"dashboard":{"is_meraki_license_page":false}}

\u2605 CORE PRINCIPLE \u2014 COPY PRODUCT NAMES, DO NOT CREATE THEM.
- items[].product is COPIED from the user's message with light cleanup only \u2014 a model as they wrote it ("MR44","CW9172I","MX84","MS220-8P"), a shorthand family ("6 mr"\u2192"mr","mv","mt"), or a license named in words ("duo essentials","umbrella DNS essentials","Systems Manager","AnyConnect Plus").
- NEVER create a product code that is not in the message. Forbidden unless the user LITERALLY typed it: strings starting "LIC-", hardware suffixes "-HW"/"-RTG", EOL replacements ("MX84" stays "MX84", never "MX85"), completed variants ("MS130-24" never becomes "MS130-24P"), or any license/term code. Do not pick a term or tier the user didn't state. Do not fold a tier word into the product.
- The engine resolves exact SKUs, suffixes, EOL replacements, licenses, term caps, and pricing. Your job is WHICH product (as typed) + HOW MANY + the per-item INTENT. If you'd have to guess the product \u2192 clarify. Not knowing SKUs is correct \u2014 you are not supposed to.

INTENT RULES:
- "quote": fresh quote or license request naming \u22651 product. A bare product ("MR46") = quote qty 1. "renewal for [products]" or "renew N [product]" = quote (per-item intent="license"; NOT revise \u2014 renewals with explicit products are fresh license quotes).
- MULTILINE RENEWAL LISTS: a message beginning "renewal for" followed by line-separated products and quantities is intent="quote" with each item intent="license". Keep every exact model line with its quantity (including EOL models \u2014 leave them named, the engine replaces). If a line is a generic family-only line ("MR x 18") mixed with exact models, keep the exact models and emit the generic family as product="mr" too (the engine resolves family\u2192agnostic) rather than dropping it.
- "price_lookup": standalone pricing question naming a SPECIFIC product with NO prior quote context \u2014 "cost of MR44", "how much is MR44", "price for MR44 with 3 year license". Set modifiers.show_pricing=true and populate items[]. "with license" phrasing keeps intent=price_lookup AND sets that item intent="normal"; do not switch to quote just because "with license" is appended. If prior_context is present and the user asks to see pricing on the prior quote ("what's the cost","with pricing"), use intent="revise" action="show_pricing".
- "revise": modifies a prior quote via a REVISION VERB or PRONOUN REFERENCE \u2014 "add X","remove X","swap X for Y","replace X","change X","make it N","license only","hardware only","3 year only","convert to","with pricing on that","show me pricing". HARD RULE #1: revise REQUIRES prior_context. If prior_context is empty/null, NEVER output revise \u2014 use quote (with the right per-item intent/modifiers) or clarify. "refresh N X","replace our X with Y","upgrade to X","just the hardware for N X","hardware only for N X","just the N year for N X" with an explicit product and NO prior_context are intent="quote". HARD RULE #2: even WITH prior_context, a message opening with a FRESH QUOTING VERB ("quote","price","send me","give me","I need","refresh","just show me") followed by an explicit product/quantity is quote, NOT revise. Revise needs a revision verb (add/remove/swap/replace/change/make it/convert) OR a pronoun/demonstrative referencing the prior quote.
- "dashboard_parse": image of a Meraki license dashboard. NEVER for messages containing stratusinfosystems.com URLs (those are the bot's own quote output).
- STRATUS URL ECHOBACK: if the user pasted a stratusinfosystems.com/order/ URL, it already contains product codes the customer gave us. For THIS URL-only case, copy each item= value exactly into product with its matching qty \u2014 one product per item= value; do NOT group, normalize, infer replacements, or create codes. intent: a product starting "LIC-" \u2192 "license"; a "-HW"/"-RTG" suffix or a bare hardware model code \u2192 "hardware". This carve-out does NOT permit SKU generation for ordinary text. Never classify URL messages as revise/dashboard_parse/conversation.
- "product_info": spec / compare / sizing / EOL-status / recommendation question \u2014 NOT a quote. "what do I need for X users","which firewall for X employees","what's the best AP for a warehouse". Also bare product-line NAMES that identify a Cisco line without a quantity/quote ask ("DNS Security Essentials","Umbrella SIG","Duo Advantage" said as a lookup).
- "escalate": complex proposal / multi-site deployment planning.
- "conversation": greeting, thanks, identity, short reactions ("lol","ok","?").

PER-ITEM INTENT \u2014 items[].intent is "hardware" | "license" | "normal". Decide scope IN THIS ORDER:
1. List-level PREFIX before an item list: "renewal/license(s) for A and B" \u2192 every listed item intent="license". "hardware for A and B" \u2192 every listed item intent="hardware".
2. Clause-level words override ONLY that clause: "A hardware only and B" \u2192 A hardware, B normal (B has no intent word \u2014 it does NOT inherit A's). "A license renewal and B" \u2192 A license, B normal. "renew A then add B hardware" \u2192 A license, B hardware.
3. Trailing plural AFTER a multi-item list applies to the whole list: "A, B, C licenses/renewals" \u2192 every listed item intent="license".
4. "with license"/"with licensing"/"and license" \u2192 intent="normal" (NOT license-only).
5. A bare product with no intent word \u2192 "normal". Ignore "hardware" inside "hardware support/model/issue/question/specs" \u2014 those items stay "normal".
Word triggers (subject to the precedence above): "hardware only"/"hw only"/"no license"/"without (the/their) license"/"just the hardware for" \u2192 hardware. "license"/"licenses"/"renewal"/"renew X"/"license only" \u2192 license.

CLARIFY \u2014 top-level clarify:{needed,question}. Set needed=true (write a short customer-facing question) when a quote would be a GUESS:
- refresh/upgrade/replace naming a CATEGORY but no target model: "4 APs, hardware refresh", "upgrade my firewalls" \u2192 ask which model. Do NOT escalate, do NOT pick a model.
- incomplete model stem needing a variant/suffix: "quote 5 MS130-24", "3 MX", bare "CW" (no digits) \u2192 ask; do NOT pick a variant.
- vague category: "need some switches", "I need wireless", "some APs", "pricing" alone.
- MIXED terms/tiers: clarify ONLY when two or more DIFFERENT terms/tiers attach to DIFFERENT product clauses \u2014 "MR44 3yr and MX67 5yr", "MX67 SEC and MX84 SDW" \u2192 clarify (per-item term/tier isn't supported yet; a shared term would misprice).
- do NOT clarify when ONE term/tier is shared by the whole request: "MR44 and MX67 5 year", "10 mx67 SEC 5 year", "MX85 SD-WAN with licensing".
- multiple terms for the SAME product/license family ("SME 1yr and 3yr", "all terms") \u2192 modifiers.all_terms=true, clarify.needed=false.
- contradictory / nonsensical input.
When clarify.needed=true, keep intent as the underlying type (usually "quote"); items may be empty or partial \u2014 the engine returns the question instead of a quote.

MODIFIER RULES (LIST-LEVEL \u2014 one value for the whole message; if they differ across items, see CLARIFY):
- term_years: 1/3/5 for "1 year"/"3 year"/"5 year"/"just the 5 year". null otherwise.
- all_terms: true for "1yr 3yr and 5yr"/"all terms"; also when multiple distinct terms are named for the SAME item set ("SME 1yr and 3yr"). (Differing terms across DIFFERENT items \u2192 clarify, not all_terms.)
- tier: "SEC" for MX "SEC"/"security"/"advanced security"; "ENT" for "ENT"/"enterprise"; "SDW" for any of "SD-WAN"/"SDW"/"SD WAN"/"sdwan" (any case); "A" for MS130/MS150/MS390/Catalyst "advanced license"/"adaptive policy". null otherwise.
- CRITICAL \u2014 SDW & tier suffixes: whenever "SDW"/"SD-WAN"/"sdwan" (any case) appears ANYWHERE, set tier="SDW" \u2014 even in a suffix ("MX85-SDW"), space-separated ("MX85 SDW"), or appended ("MX85 SD-WAN with licensing"). If a product carries a tier suffix or space-separated tier word ("MX85-SDW","MX67 SEC","MX75 enterprise"), STRIP it: product is the base model ("MX85"), tier goes in modifiers. Never embed the tier in items[].product.
- show_pricing: true for pricing intent ("cost","how much","with pricing","price").
- CRITICAL \u2014 separate_quotes: set true whenever the user asks for one URL/quote/link PER item, tier, or line. Triggers (any case, anywhere): "separate quote[s]/url[s]/link[s]","individual quote[s]/url[s]/link[s]","each as its own ...","each separately","one per line","one per tier","break (these|them) out","split into separate","X url, Y url, Z url". When true, items[] MUST contain EVERY distinct thing named so the renderer can produce one URL each \u2014 never collapse a multi-item/multi-tier request into one item.

REVISION RULES (only when prior_context present):
- action: "add"/"remove"/"swap"/"change_term"/"change_tier"/"toggle_hw_lic"/"change_qty"/"show_pricing".
- "license only"/"hardware only" AFTER a prior quote \u2192 action="toggle_hw_lic", hw_lic_toggle="license_only"/"hardware_only". (With NO prior_context, the same phrasing on an explicit product is intent="quote" with that item intent="license"/"hardware".)
- "3 year only"/"make it 5 year" \u2192 change_term. "add 2 MX67" \u2192 add, add_items=[{product:"MX67","qty":2}]. "remove MR44" \u2192 remove, target_sku="MR44". SWAP "swap X for Y"/"replace X with Y"/"change X to Y" \u2192 ONE atomic action="swap", target_sku="X", add_items=[{product:"Y"}]; never split into remove+add.
- Pricing follow-up ("what's the cost","with pricing","how much") \u2192 action="show_pricing", modifiers.show_pricing=true, reference.resolve_from_history=true (no item/term/tier change).
- For revisions set reference.resolve_from_history=true. "renewal for [products]" is NOT a revision \u2014 it's a fresh quote with item intent="license".

REFERENCE RULES:
- is_pronoun_ref: true for "that"/"those"/"it"/"them"/"this"/"these"/"the switch"/"the AP"/"the quote".
- option_ref: 1/2/3 if "Option 1/2/3". resolve_from_history: true whenever the message only makes sense with prior context.

PRODUCT KNOWLEDGE (to RECOGNIZE products \u2014 NOT to emit SKUs):
- Meraki families: MR (APs), MX (firewalls), MS (switches), MV (cameras), MT (sensors), MG (cellular), Z (teleworker), CW (Wi-Fi 6E/7). Catalyst: C9300/C9300L/C9300X/C9200L/C8xxx. Accessories: MA-* (transceivers, cables, PSUs, mounts).
- License lines named in words \u2192 product = the words, item intent="license": "duo essentials/advantage/premier", "umbrella DNS/SIG essentials/advantage", "AnyConnect Plus/Apex" (a.k.a. Cisco Secure Client / Cisco VPN \u2014 IS in catalog, never say we don't sell it), "Systems Manager"/"SME", "enterprise license". Copy the words exactly as the customer wrote them; the engine maps them to the right license SKU. Do NOT write any "LIC-..." string yourself.
- If the customer names BOTH a tier and a product ("MX67 SEC"), product="MX67" + modifiers.tier="SEC". If they name a license family with a tier ("duo advantage"), product="duo advantage" (the tier is part of the named line, leave it in the product words).
- If a model looks valid but you don't recognize it (new or EOL), still emit it as named \u2014 the engine validates and replaces.
- Word numbers: one=1 \u2026 ten=10, "a couple"=2, "a few"=3.

EXAMPLES:
- "1 CW9172I hardware only and 6 MR44" \u2192 intent quote, clarify.needed false, items=[{product:"CW9172I","qty":1,intent:"hardware"},{product:"MR44","qty":6,intent:"normal"}]
- "6 mr and 1 mx84 enterprise license renewal and 1 CW9172I hardware only" \u2192 items=[{product:"mr","qty":6,intent:"license"},{product:"mx84","qty":1,intent:"license"},{product:"CW9172I","qty":1,intent:"hardware"}], modifiers.tier="ENT"
- "renew MX67 then add MR44 hardware" \u2192 items=[{product:"MX67","qty":1,intent:"license"},{product:"MR44","qty":1,intent:"hardware"}]
- "10 duo essentials and 6 mr44" \u2192 items=[{product:"duo essentials","qty":10,intent:"license"},{product:"mr44","qty":6,intent:"normal"}]
- "quote 6 mr44 without the license" \u2192 items=[{product:"mr44","qty":6,intent:"hardware"}]
- "4 APs, hardware refresh" \u2192 intent quote, clarify.needed true, question asks which model; items=[]
- "quote 5 MS130-24" \u2192 clarify.needed true (needs the port/uplink variant); items=[]
- "MR44 3yr and MX67 5yr" \u2192 clarify.needed true (mixed terms \u2014 ask which term applies); items=[{product:"MR44","qty":1,intent:"normal"},{product:"MX67","qty":1,intent:"normal"}]
- "SME license 1yr and 3yr" \u2192 items=[{product:"Systems Manager","qty":1,intent:"license"}], modifiers.all_terms=true
- "10 mx67 SEC 5 year" \u2192 items=[{product:"MX67","qty":10,intent:"normal"}], modifiers.tier="SEC", modifiers.term_years=5

Return ONLY the JSON object. Emit STRICT JSON: EVERY key must be double-quoted, including numeric keys \u2014 write "qty":10 NEVER qty:10. No markdown fences. No explanation.`;
function buildTierClarifyContinuation(text, lastAssistantContent) {
  if (!text || !lastAssistantContent) return null;
  const reply = String(text).trim();
  if (reply.length > 48) return null;
  if (reply.includes("?")) return null;
  if (/\b(cost|price|pricing|much|what|which|why|how|who|compare|vs|versus|spec|specs|info|difference|datasheet)\b/i.test(reply)) return null;
  if (/\b(?:MR|MX|MS|MV|MT|MG|CW|C9|C8|Z)\d/i.test(reply)) return null;
  const duoM = lastAssistantContent.match(/Which Cisco Duo tier do you need\? \(qty:\s*(\d+)\)/i);
  const umbM = lastAssistantContent.match(/Which Umbrella package do you need\? \(qty:\s*(\d+)(?:,\s*type:\s*(DNS|SIG))?\)/i);
  if (!duoM && !umbM) return null;
  if (/\b(no|not|never|without|except|neither|nor|maybe|instead|anything but|all but|other than|rather than)\b|\bdon[’']?t\b/i.test(reply)) return null;
  const tierMatches = [...reply.matchAll(/\b(essentials?|advantage|premier)\b/gi)].map((m) => /^essential/i.test(m[1]) ? "essentials" : m[1].toLowerCase());
  if (new Set(tierMatches).size !== 1) return null;
  const tierWord = tierMatches[0];
  const termM = reply.match(/\b([135])\s*-?\s*(?:year|yr)s?\b/i);
  const replySansTerm = termM ? reply.replace(termM[0], " ") : reply;
  const termSuffix = termM ? " " + termM[1] + " year" : "";
  const qtyOverride = (replySansTerm.match(/\b(\d+)\b/) || [])[1];
  if (duoM) {
    const qty2 = qtyOverride || duoM[1];
    return qty2 + " duo " + tierWord + " licenses" + termSuffix;
  }
  const typeM = reply.match(/\b(dns|sig)\b/i) || (/\bsecure\s+internet\s+gateway\b/i.test(reply) ? [null, "sig"] : null) || (umbM[2] ? [null, umbM[2]] : null);
  if (!typeM || tierWord === "premier") return null;
  const qty = qtyOverride || umbM[1];
  return qty + " umbrella " + typeM[1].toLowerCase() + " " + tierWord + " licenses" + termSuffix;
}
__name(buildTierClarifyContinuation, "buildTierClarifyContinuation");
var CF_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
async function classifyV3(userMessage, priorContext, env) {
  if (!env || !env.AI) return null;
  try {
    const userText = priorContext ? `Prior assistant context:
${priorContext}

User message:
${userMessage}` : String(userMessage || "");
    const result = await Promise.race([
      env.AI.run(CF_MODEL, { messages: [{ role: "system", content: CF_CLASSIFIER_PROMPT_V3 }, { role: "user", content: userText }], max_tokens: 512 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("V3_TIMEOUT")), 8e3))
    ]);
    const rawResponse = result?.response ?? result?.choices?.[0]?.message?.content;
    if (typeof rawResponse === "object" && rawResponse !== null && rawResponse.intent) return rawResponse;
    const raw = typeof rawResponse === "string" ? rawResponse.trim() : String(rawResponse || "");
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}
__name(classifyV3, "classifyV3");
var USE_V2_CLASSIFIER = true;
var CF_GROUNDING_RULES = `

## CRITICAL RULES \u2014 FOLLOW EXACTLY (these override any conflicting instruction above)

1. GROUNDING. Every factual claim must be directly supported by the PRODUCT SPECS, DATASHEET, PRICING, or ACCESSORIES context provided in this system prompt. Do NOT supplement with training-data facts. If a spec is missing, say "I do not have that data" \u2014 never guess.

2. FLAGSHIP / HIGHEST-END / BEST. Do NOT call any product a "flagship", "highest-end", "top-tier", "best", or equivalent UNLESS that model has the single highest value on the relevant spec (throughput Gbps, port count, radio generation) among every product listed in the injected specs above. When the user asks for the flagship and the true flagship is not in context, explicitly say the highest-end model in that family (MX450 for MX, MS450 for MS, CW9176 for CW Wi-Fi 7) and note you can pull its full specs on request.

3. PRICING. If the injected context contains a PRICING section or lines starting with "PRICE:", you MUST use those exact prices. Never respond "I don't have pricing" when pricing is present above. Copy the price values verbatim \u2014 do not round, estimate, or re-derive.

4. MULTI-PRODUCT ORDER URLS. When the user asks about multiple distinct products and you output Stratus order links, produce ONE URL per product. Never concatenate SKUs from different products into a single item list. Format: https://stratusinfosystems.com/order/?item={SKU}&qty={N}

5. UNCERTAINTY. If a requested spec, SKU, or price is not in the context above, say so plainly. Do NOT invent SKUs that are not in the SPECS / PRICING / DATASHEET blocks.

6. WEBEX FORMATTING. This response renders in Webex chat, which does NOT render markdown tables (| col | col |). For multi-product comparisons, use grouped bullets per model instead. Format:
**ModelA**
\u2022 Spec1: value
\u2022 Spec2: value

**ModelB**
\u2022 Spec1: value
\u2022 Spec2: value

Followed by a short **Summary:** paragraph naming the practical difference. Keep bolding for model names and spec categories only. Never output a pipe-delimited table row.
`;
function classifyProductInfoSubtype(userMessage, hasImage) {
  if (hasImage) return "advisory";
  const m = (userMessage || "").trim();
  if (!m) return "advisory";
  const upper = m.toUpperCase();
  const SUPERLATIVE = /\b(HIGHEST[\s-]?END|FLAGSHIP|TOP[\s-]?(TIER|OF[\s-]THE[\s-]LINE|END)|BEST|MOST\s+POWERFUL|BIGGEST|FASTEST|LARGEST|MOST\s+CAPABLE)\b/;
  const COMPARISON = /\b(COMPARE|COMPARISON|VS\.?|VERSUS|DIFFERENCE\s+BETWEEN|DIFFER|BETTER\s+THAN)\b/;
  const PRICING = /\b(COSTS?|PRICES?|PRICING|HOW\s+MUCH|BUDGET|BREAKDOWN|ESTIMATE|TOTAL|QUOTE\s+THE\s+COST|SPEND)\b/;
  const RECOMMEND = /\b(RECOMMEND|SUGGEST|WHAT\s+SHOULD\s+I|WHAT\s+DO\s+I\s+NEED|WHICH\s+(FIREWALL|SWITCH|AP|ACCESS\s+POINT|CAMERA|DEVICE|PRODUCT)|SIZE\s+(FOR|A)|FOR\s+A?\s*(SCHOOL|HOSPITAL|OFFICE|WAREHOUSE|CAMPUS)\s+(OF|WITH)?)\b/;
  const MULTI_MODEL = /\b(MR\d+|CW\d+|MX\d+|MS\d+|MV\d+|MT\d+|MG\d+|Z\d)\D+?(MR\d+|CW\d+|MX\d+|MS\d+|MV\d+|MT\d+|MG\d+|Z\d)\b/i;
  if (SUPERLATIVE.test(upper)) return "advisory";
  if (PRICING.test(upper)) return "advisory";
  if (RECOMMEND.test(upper)) return "advisory";
  const SINGLE_MODEL_SPEC = /\b(SPECS?|SPECIFICATIONS?|DETAILS?|FEATURES?|CAPABILIT|WHAT\s+IS\s+(THE\s+)?(MR|CW|MX|MS|MV|MT|MG|Z)\d+|TELL\s+ME\s+ABOUT|WHAT\s+DOES\s+(THE\s+)?(MR|CW|MX|MS|MV|MT|MG|Z)\d+\s+DO|INFO\s+ON)\b/;
  const LICENSE_Q = /\b(LICENS(E|ING)|WHAT\s+LICENSE|LICENSE\s+(TERM|TYPE|DOES)|LIC-ENT|LIC-MS|LIC-MX|LIC-MV|LIC-MT|LIC-MG|LIC-SME)\b/;
  const EOL_Q = /\b(EOL|END[\s-]OF[\s-]LIFE|REPLACES?|REPLACEMENT|SUCCESSOR|MIGRATION\s+PATH|WHAT\s+(TO|SHOULD|DO)\s+(I\s+)?REPLACE|UPGRADE\s+PATH)\b/;
  const DATASHEET_FOLLOWUP = /\b(DATASHEET|SPEC\s+SHEET|SPECIFICS|MORE\s+DETAILS?|RADIO\s+COUNT|PORT\s+COUNT|THROUGHPUT)\b/;
  const MODEL_IN_MSG = /\b(MR|CW|MX|MS|MV|MT|MG|Z)\d+[A-Z0-9-]*\b/i;
  const hasModel = MODEL_IN_MSG.test(m);
  if (DATASHEET_FOLLOWUP.test(upper)) return "advisory";
  if (MULTI_MODEL.test(m) && COMPARISON.test(upper)) return "simple_lookup";
  if (MULTI_MODEL.test(m)) return "simple_lookup";
  if (COMPARISON.test(upper)) return "advisory";
  if (SINGLE_MODEL_SPEC.test(upper)) return hasModel ? "simple_lookup" : "advisory";
  if (LICENSE_Q.test(upper)) return hasModel ? "simple_lookup" : "advisory";
  if (EOL_Q.test(upper)) return hasModel ? "simple_lookup" : "advisory";
  return "advisory";
}
__name(classifyProductInfoSubtype, "classifyProductInfoSubtype");
var CF_CLASSIFIER_PROMPT = `You are an intent classifier and clarification engine for a Cisco/Meraki quoting bot. Your job is to classify what the user wants and ask smart clarifying questions when their request is incomplete. You do NOT answer product questions \u2014 those go to a more capable AI.

Respond with ONLY a JSON object, nothing else.

Categories:
- "quote": User wants a quote or pricing. They mention a specific model (MR46, MS130-8P, MX67, CW9164, MT14, Z4, MG51, etc.) with or without a quantity, or a bare license SKU (LIC-ENT-3YR, LIC-MV-5YR), or a generic license request ("5 MR licenses", "MR44 license"). Even if the model is EOL or unknown to you, classify as "quote" \u2014 the backend validates SKUs. If no quantity specified, assume 1. Extract the clean request.
- "clarify": User wants a quote but is too vague OR specified an incomplete model that needs a variant selection. Generate a helpful clarification using the variant tables below. Examples: "quote me some switches" (which model?), "I need APs" (which model?), "quote 5 MS130-24" (1G or 10G uplinks?), "pricing for Meraki" (which product family?).
- "product_info": User is asking about specs, features, sizing, recommendations, comparisons, EOL, compatibility, or capabilities \u2014 NOT asking for a quote. Examples: "what firewall for 50 users", "difference between MR46 and CW9164", "does MX67 support SD-WAN", "is MV22 weatherproof", "is MR46 indoor or outdoor". Set reply to empty \u2014 these go to the advanced AI.
- "escalate": Complex requests needing the advanced AI. Use for: proposal writing, deployment planning, detailed technical analysis. Set reply to empty.
- "conversation": Greetings, thanks, farewells, jokes, identity questions, general chat, non-product topics, single characters ("q", "?", "!"), short reactions ("nice", "cool", "ok", "lol").

CRITICAL RULES:
- Never use "unclear" as an intent.
- product_info reply MUST be empty. Never answer product questions yourself.
- For "clarify", always generate a reply asking which specific model/variant.
- Single word "price" or "pricing" alone = "clarify".
- "MR44 license" or "licenses for 3 MT" = "quote".
- "LIC-ENT-3YR" or any bare license SKU = "quote".
- Any SKU + "hardware only", "hw only", "no license", "hardware no license" = "quote". Example: "MX85 hardware only no license" = quote for MX85-HW.
- Any SKU + "license only", "licenses only", "just the license", "renewal only" = "quote". Example: "MR46 license only 3 year" = quote for LIC-ENT-3YR.
- Any SKU + "add-on", "add on license", "co-term", "coterm" = "quote".
- SDW TIER RULE: Any MX model followed by "SDW", "SD-WAN", "SD WAN", "sdwan", "sd-wan", or suffix "-SDW" = "quote" for that MX with SD-WAN license. Examples: "MX85-SDW 3 year" \u2192 quote 1 MX85 with SD-WAN 3yr license; "MX75 sdwan" \u2192 quote 1 MX75 with SD-WAN license; "MX95 SD-WAN with licensing" \u2192 quote 1 MX95 with SD-WAN license. The base SKU is the MX model (e.g., "MX85"), the tier is SD-WAN. NEVER drop the SDW tier and NEVER classify these as "clarify".
- SWAP RULE: "swap X for Y", "replace X with Y", "change X to Y", "substitute X with Y" = "quote" for Y (with qty if given). Keep the swapped-out SKU X as context in extracted. Example: "swap MR44 for 5 MR46 3 year" \u2192 quote 5 MR46 with 3 year license (swapping out MR44). Treat swap as a single atomic quote, never as separate remove + add operations.
- A bare model number with no other context (e.g. "MX85", "MR46", "CW9164") = "quote" with qty 1.
- Renewal/refresh phrasing with a SKU = "quote": "renew MR46 licenses", "refresh 10 MR44s", "replace MV22".
- When generating variant clarifications, ONLY suggest models from the variant tables above. NEVER invent model numbers like "MS150-8" or "MS150-16" \u2014 those do not exist.
- If a bare family name is given (e.g., "MS150", "MS130") with a port count ambiguity, ask port count FIRST, then variant.

VARIANT CLARIFICATION TABLES (use when user gives an incomplete model):
MS switches with variants \u2014 if user says just the base model, ask which:
- MS130-8: 8-port compact (no variants)
- MS130-12: 12-port \u2192 MS130-12P (PoE, 1G) or MS130-12X (mGig, 10G uplinks)
- MS130-24: 24-port \u2192 MS130-24P (PoE, 1G uplinks) or MS130-24X (PoE, 10G uplinks)
- MS130-48: 48-port \u2192 MS130-48P (PoE, 1G uplinks) or MS130-48X (PoE, 10G uplinks)
- MS210-24: 24-port \u2192 MS210-24P (PoE) or MS210-24 (no PoE)
- MS210-48: 48-port \u2192 MS210-48FP (full PoE) or MS210-48LP (partial PoE) or MS210-48 (no PoE)
- MS225-24: 24-port \u2192 MS225-24P (PoE) or MS225-24 (no PoE)
- MS225-48: 48-port \u2192 MS225-48FP (full PoE) or MS225-48LP (partial PoE) or MS225-48 (no PoE)
- MS250-24: 24-port \u2192 MS250-24P (PoE) or MS250-24 (no PoE)
- MS250-48: 48-port \u2192 MS250-48FP (full PoE) or MS250-48LP (partial PoE) or MS250-48 (no PoE)
- MS390-24: \u2192 MS390-24P (PoE), MS390-24UX (mGig+UPOE), MS390-24U (mGig)
- MS390-48: \u2192 MS390-48P (PoE), MS390-48UX (mGig+UPOE), MS390-48UX2 (mGig+UPOE 2nd gen), MS390-48U (mGig)
- MS150-24: 24-port \u2192 MS150-24T-4G (no PoE, 1G uplinks), MS150-24P-4G (PoE, 1G uplinks), MS150-24T-4X (no PoE, 10G uplinks), MS150-24P-4X (PoE, 10G uplinks), MS150-24MP-4X (mGig PoE, 10G uplinks)
- MS150-48: 48-port \u2192 MS150-48T-4G (no PoE, 1G), MS150-48LP-4G (partial PoE, 1G), MS150-48FP-4G (full PoE, 1G), MS150-48T-4X (no PoE, 10G), MS150-48LP-4X (partial PoE, 10G), MS150-48FP-4X (full PoE, 10G), MS150-48MP-4X (mGig PoE, 10G)
- MS150 (no port count): Ask "24-port or 48-port?" first, then ask variant.

MX sizing by user count (for basic sizing clarifications):
- Up to 50 users: MX67 ($595) or MX68 ($795)
- Up to 200 users: MX75 ($2,195)
- Up to 600 users: MX85 ($3,995)
- Up to 2,000 users: MX95 ($7,995)
- Up to 5,000 users: MX105 ($12,995)
- Up to 10,000 users: MX250 ($19,995)
- Unlimited: MX450 ($34,995)

Product families (for vague "I need switches/APs/cameras" clarifications):
MR access points: MR28, MR36H, MR44 (End-of-Sale), MR46, MR57, MR78
CW Wi-Fi 7 access points: CW9162, CW9164, CW9166, CW9172, CW9176
MS switches: MS130 (8/12/24/48-port, 1G/10G), MS150 (24/48-port, 1G/10G, replaces MS210/220/225/320), MS390 (24/48-port, mGig), MS450 (12-port)
MX security appliances: MX67, MX68, MX75, MX85, MX95, MX105, MX250, MX450
MV cameras: MV2, MV12, MV22, MV32, MV72, MV93
MT sensors: MT14, MT15, MT20, MT40
Teleworker: Z4, Z4C
Cellular: MG51, MG52
IMPORTANT \u2014 Unknown/EOL model rule: If a user mentions a model number that follows Cisco/Meraki naming patterns (MR##, MX##, MS###-##, MV##, CW####, MT##, Z#, MG##) but is NOT in the active product list above, it is likely end-of-life or a typo. ALWAYS classify as "quote" if they want pricing \u2014 NEVER "clarify". The backend has full EOL data and handles replacement mapping automatically.

Respond with ONLY this JSON:
{"intent":"<category>","reply":"<for clarify or conversation only. MUST be empty for quote, product_info, escalate>","extracted":"<for quote only: extract clean request like 'quote 10 MR46 with 3 year license'. Empty for all other intents>"}`;
var CF_CONVO_PROMPT = `You are Stratus AI, the internal quoting assistant for Stratus Information Systems, a Cisco-exclusive reseller specializing in Meraki networking products. We also quote Cisco security licenses: Duo MFA, Umbrella DNS/SIG, and AnyConnect/Cisco Secure Client/Cisco VPN (APX and PLS tiers). Be friendly, concise, and professional. Keep responses under 4 sentences.

Key product knowledge:
- MX security appliances: MX67 ($595, 50 users), MX68 ($795, 50), MX75 ($2,195, 200), MX85 ($3,995, 600), MX95 ($7,995, 2000), MX105 ($12,995, 5000), MX250 ($19,995, 10000), MX450 ($34,995, unlimited)
- MR access points: MR28 ($495), MR36H ($595), MR44 ($995, EoS-replaced by CW9164), MR46 ($1,295), MR57 ($1,895), MR78 ($2,495)
- MS switches: MS120-8 ($595), MS130-8 ($695), MS210-24 ($2,495), MS225-24 ($3,495), MS250-24 ($4,995), MS390-24 ($7,995)
- CW Wi-Fi 7: CW9162 ($995), CW9164 ($1,495), CW9166 ($1,995), CW9172 ($2,495), CW9176 ($3,995)
- MV cameras: MV2 ($495), MV12 ($995), MV22 ($1,295), MV32 ($1,995), MV72 ($3,495), MV93 ($4,995)
- MT sensors: MT14 ($149), MT15 ($199), MT20 ($129), MT40 ($199) \u2014 free tier up to 100 sensors
- All hardware needs a license (1yr/3yr/5yr). APs use LIC-ENT-. MX uses LIC-SEC- or LIC-ENT-.

For quote requests, tell users to say "quote [qty] [model]" and you'll generate an instant quote.`;
function extractAIResponse(result) {
  const raw = result?.response ?? result?.choices?.[0]?.message?.content ?? "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "object") return JSON.stringify(raw);
  return String(raw);
}
__name(extractAIResponse, "extractAIResponse");
var CF_CLASSIFIER_PROMPT_V2 = `You are an intent classifier for a Cisco/Meraki quoting bot. Output a single JSON object \u2014 no prose, no markdown.

SCHEMA:
{"intent":"quote|revise|price_lookup|dashboard_parse|clarify|product_info|escalate|conversation","confidence":0.0-1.0,"reply":"","items":[{"sku":"...","qty":1,"sku_type":"hardware|license|accessory"}],"modifiers":{"hardware_only":false,"license_only":false,"with_license":null,"term_years":null,"tier":null,"show_pricing":false,"all_terms":false,"separate_quotes":false},"revision":{"action":null,"target_sku":null,"add_items":[],"new_term":null,"new_tier":null,"new_qty":null,"hw_lic_toggle":null},"reference":{"is_pronoun_ref":false,"option_ref":null,"resolve_from_history":false},"dashboard":{"is_meraki_license_page":false}}

INTENT RULES:
- "quote": fresh quote or license request with \u22651 explicit SKU. Bare SKU ("MR46") = quote qty 1. "renewal for [SKU list]" or "renew N [SKU]" = quote with license_only=true (NOT revise \u2014 renewals with explicit SKUs are fresh license quotes).
- MULTILINE RENEWAL LISTS: A message beginning "renewal for" followed by line-separated product models and quantities is intent="quote" with modifiers.license_only=true. Extract every exact model line as an item with its stated quantity, including EOL models; do not clarify just because one line is generic. If the list mixes exact models with a generic family-only line like "MR x 18", keep the exact model items and omit the generic family line rather than changing the whole message to clarify.
- "price_lookup": standalone pricing question naming a SPECIFIC SKU with NO prior quote context \u2014 "cost of MR44", "how much is MR44", "price for MR44", "cost of MS150-24P-4G with license", "how much is MR44 with 3 year license", "what does MR46 cost with licensing". With-license phrasing sets modifiers.with_license=true and modifiers.term_years (if stated), but intent STAYS price_lookup \u2014 do NOT switch to quote just because "with license" is appended. If prior_context is present AND the user is asking to see pricing on the prior quote (e.g. "what is the cost", "how much", "with pricing"), use intent="revise" with action="show_pricing" instead.
- PRICE LOOKUP COMPLETENESS: For intent="price_lookup", always populate items[] with every specific SKU named in the message and set modifiers.show_pricing=true. Never return price_lookup with empty items[] when a SKU is present. Examples: "cost of MR46" \u2192 items=[{sku:"MR46",qty:1,sku_type:"hardware"}], show_pricing=true; "need pricing on an MS130-24P" \u2192 items=[{sku:"MS130-24P",qty:1,sku_type:"hardware"}], show_pricing=true.
- BARE WITH-LICENSE QUOTE: A standalone SKU followed by "with license", "with licensing", or "and license" is a fresh quote, not a price lookup, unless the message also contains a pricing word like "cost", "price", "how much", or "pricing". Example: "MS150-24P-4G with license" \u2192 intent="quote", items=[{sku:"MS150-24P-4G",qty:1,sku_type:"hardware"}], modifiers.with_license=true.
- "revise": message modifies a prior quote using a REVISION VERB or PRONOUN REFERENCE \u2014 "add X", "remove X", "swap X for Y", "replace X", "change X", "make it N", "license only", "hardware only", "3 year only", "convert to", "toggle", "with pricing on that", "show me pricing". HARD RULE #1: "revise" requires prior_context to be present. If prior_context is empty/null, NEVER output "revise" \u2014 use "quote" or "clarify" instead. This is absolute: "refresh N X", "replace our X with Y", "upgrade to X", "just the hardware for N X", "hardware only for N X", "just show me the N year for N X", "just the N year for N X", "N year only for N X", and any hw/license/term-modifier phrasing that NAMES an explicit SKU must be intent="quote" (with appropriate modifiers) when prior_context is empty. HARD RULE #2: even when prior_context IS present, a message that opens with a FRESH QUOTING VERB ("quote", "price", "send me", "give me", "get me", "I need", "can you quote", "let me see", "pull up", "build me", "refresh", "upgrade", "just show me") followed by an explicit product family, SKU, or quantity is intent="quote", NOT revise. Revise requires either a revision verb (add/remove/swap/replace/change/make it/convert/toggle) OR a pronoun/demonstrative referencing the prior quote (it/that/these/those/the quote/the switches/the APs). Examples that ARE quote even with prior_context: "quote MR44", "quote all duo licenses", "quote 10 duo essentials as separate quotes", "price me a MX85", "refresh 5 MX64", "just the hardware for 3 MR46", "just show me the 5 year for 10 MR46". Examples that ARE revise: "add 2 MR44", "swap them for MR46", "make it 5 year", "with pricing", "change to SEC".
- "dashboard_parse": image of Meraki license dashboard. NEVER use for messages containing stratusinfosystems.com URLs \u2014 those are the bot's own quote output, not dashboards.
- STRATUS URL ECHOBACK: Messages containing a stratusinfosystems.com/order/ URL (with or without follow-on bullet lines summarizing items/pricing) are quote echoes, not revisions. Parse the ?item= and &qty= params in the URL and emit intent="quote" with items[] populated from those params (one item per URL position, sku_type inferred from the SKU: LIC-* \u2192 license, HW/bare model \u2192 hardware). This holds even when prior_context is present \u2014 the user is confirming or re-sending a fresh quote spec, not revising a prior one. NEVER classify stratusinfosystems.com URL messages as revise, dashboard_parse, or conversation.
- STRATUS URL ITEM FIDELITY: For stratusinfosystems.com/order URLs, copy each item= SKU exactly as written in the URL params. Do not infer, normalize, or drop tier segments from license SKUs. Example: item=MX85,LIC-MX85-SEC-5Y&qty=1,1 \u2192 items=[{sku:"MX85",qty:1,sku_type:"hardware"},{sku:"LIC-MX85-SEC-5Y",qty:1,sku_type:"license"}].
- "clarify": quote request too vague \u2014 "some switches", "need APs", "pricing" alone. Also when a SKU stem is given WITHOUT its required variant suffix: "quote 5 MS130-24" (MS130-24 needs port/uplink suffix like -4G/-2X), "5 MS250", "3 MX" (no model number). Ambiguous SKU stems override the quoting verb \u2014 even "quote 5 MS130-24" is clarify, not quote. HARD RULE: family + base model number without the variant/port suffix = clarify, regardless of verb.
- "product_info": spec, compare, size, capability, EOL-status, or sizing/recommendation question \u2014 NOT a quote. Includes: "what do I need for X users", "what do you recommend for X", "which firewall for X employees", "what's the best AP for a warehouse". Also use for bare product/license category NAMES that identify a specific Cisco product line without asking for a quote: "DNS Security Essentials", "DNS Security Advantage", "Umbrella SIG", "Duo Advantage", "Meraki Advanced Security", "SecureX" \u2014 these are product-line lookups, classify as product_info (not clarify). If the user is asking WHAT to buy or naming a product line (not quoting a specific SKU with quantity), it's product_info.
- "escalate": complex proposal / deployment planning.
- "conversation": greeting, thanks, jokes, identity, short reactions ("lol","ok","?").

MODIFIER RULES:
- hardware_only: "hw only","hardware only","no license","just hardware","without licensing".
- license_only: "license only","just the license","licenses only","renewal only","renew X","renewal for X","lic only". When the user says "renewal for [devices]" they want license quotes \u2014 set license_only=true and intent="quote".
- with_license: true when user says "with license","with licensing","and license". null otherwise.
- term_years: 1/3/5 for "1 year"/"3 year"/"5 year"/"three year"/"just the 5 year". null otherwise.
- tier: "SEC" for MX "SEC"/"security"/"advanced security"; "ENT" for "ENT"/"enterprise"; "SDW" for any of "SD-WAN"/"SDW"/"SD WAN"/"sdwan"/"sd-wan"/"sd wan" (case-insensitive); "A" for MS130/MS150/MS390/Catalyst switch Advanced license requests such as "advanced license" or "adaptive policy". null otherwise.
- CRITICAL \u2014 SDW TIER: Whenever the user says "SDW", "SD-WAN", "SD WAN", "sdwan", or any case variant ANYWHERE in the message, you MUST set modifiers.tier="SDW". Never drop it. Never leave tier as null when these phrasings are present. This applies even when the phrasing is in a suffix (MX85-SDW), separated by space (MX85 SDW), or appended after the model (MX85 SD-WAN with licensing).
- TIER SUFFIX SPLITTING: If a SKU has a tier suffix or space-separated tier word appended \u2014 examples: "MX85-SDW", "MX85 SDW", "MX85 sdwan", "MX85-SD-WAN", "MX67-SEC", "MX67 SEC", "MX75-ENT", "MX75 enterprise" \u2014 SPLIT it: put the base model in items[].sku (e.g., "MX85") and the tier in modifiers.tier (e.g., "SDW"). Never include the tier suffix as part of the SKU string. Never leave the tier as null when you've stripped a tier suffix.
- show_pricing: true for pricing intent ("cost","how much","with pricing","price").
- all_terms: true when user says "1yr 3yr and 5yr" or "all terms".
- Multiple explicit terms such as "1yr and 3yr", "1 year / 3 year", or "1, 3, and 5 year" mean modifiers.all_terms=true unless the user asks for only one term.
- CRITICAL \u2014 separate_quotes: Set modifiers.separate_quotes=true whenever the user asks for one URL/quote/link PER item, tier, or line. Trigger phrases (case-insensitive, match anywhere in the message): "separate quote[s]", "separate url[s]", "separate link[s]", "individual quote[s]/url[s]/link[s]", "each as its own quote/url/link", "each separately", "as separate ...", "one per line", "one per tier", "break (these|them|it) out", "split (into|up into) separate", "X url, Y url, Z url". CRITICAL: NEVER leave separate_quotes=false when any of the above appears. When separate_quotes=true, items[] MUST contain EVERY distinct thing the user named so the renderer can produce one URL per item \u2014 never collapse multi-tier or multi-item requests into a single item. Examples:
  * "quote 10 duo essentials and advantage as separate quotes" \u2192 items=[{sku:"LIC-DUO-ESSENTIALS-3YR",qty:10,sku_type:"license"},{sku:"LIC-DUO-ADVANTAGE-3YR",qty:10,sku_type:"license"}], separate_quotes=true
  * "MR44 and MS130-24 as separate links" \u2192 items=[{sku:"MR44",qty:1},{sku:"MS130-24",qty:1}], separate_quotes=true
  * "all duo licenses as separate quotes" \u2192 (see "all DUO/UMBRELLA" expansion rule below), separate_quotes=true
  * "give me separate URLs for 5 MR46 and 5 MR56" \u2192 items=[{sku:"MR46",qty:5},{sku:"MR56",qty:5}], separate_quotes=true

REVISION RULES:
- CRITICAL: Only use intent="revise" when prior_context is provided. If prior_context is empty or absent, the message is standalone \u2014 classify as "quote", "clarify", or another intent instead.
- action: "add"/"remove"/"swap"/"change_term"/"change_tier"/"toggle_hw_lic"/"change_qty"/"show_pricing".
- "license only"/"hardware only" AFTER prior quote (prior_context present) \u2192 action=toggle_hw_lic, hw_lic_toggle="license_only"/"hardware_only". If prior_context is EMPTY and the same phrasing is used with an explicit SKU ("just the hardware for 3 MR46", "5 MX67 no license"), this is intent="quote" with modifiers.hardware_only=true \u2014 NOT revise.
- "3 year only"/"make it 5 year" \u2192 action=change_term, new_term=3 or 5.
- "add 2 MX67" \u2192 action=add, add_items=[{sku:"MX67",qty:2}].
- "remove MR44"/"take out MR44" \u2192 action=remove, target_sku="MR44".
- SWAP \u2014 any of "swap X for Y", "replace X with Y", "change X to Y", "substitute X with Y", "exchange X for Y" \u2192 action="swap", target_sku="X", add_items=[{sku:"Y", qty: if given}]. Examples: "swap MR44 for MR46" \u2192 swap, target MR44, add MR46; "replace the MR44s with MR46" \u2192 swap, target MR44, add MR46; "change MX75 to MX85" \u2192 swap, target MX75, add MX85. CRITICAL: Swap is ONE atomic action. NEVER split "swap X for Y" into separate action="remove" (X) + action="add" (Y) \u2014 that loses the swap semantics. Always emit a single revise with action="swap".
- "make it 5" \u2192 action=change_qty, new_qty=5.
- "change to SEC" \u2192 action=change_tier, new_tier="SEC".
- AnyConnect tier swap: "change that to Apex"/"swap to Plus"/"make it PLS" on a prior AnyConnect quote \u2192 action=change_tier with new_tier="APX" (for Apex/APX) or new_tier="PLS" (for Plus/PLS). These tier values only apply when the prior quote contains AnyConnect SKUs (LIC-L-AC-*).
- Pricing follow-up on a prior quote \u2014 the user wants to see the dollar figures on items they've already been quoted. Natural-language examples: "what is the cost", "how much", "how much is that", "how much does it cost", "what's the price", "with pricing", "add pricing", "show me pricing", "give me pricing", "what's this cost", "total cost", "the price", "pricing" \u2014 basically any message that asks about cost/price/pricing without introducing new SKUs or changing the spec. \u2192 action="show_pricing", set modifiers.show_pricing=true, reference.resolve_from_history=true. This is a no-op on items/term/tier \u2014 keep the prior quote exactly as-is and just render it with pricing visible. Trust the semantic meaning of the message; you don't need the exact phrase to match \u2014 if the intent is "I want to see the cost of what you just quoted," use show_pricing.
- For revisions: set reference.resolve_from_history=true.
- "renewal for [device list]" is NOT a revision \u2014 it's a fresh quote with license_only=true.

REFERENCE RULES:
- is_pronoun_ref: true for "that"/"those"/"it"/"them"/"this"/"these"/"the switch"/"the AP"/"the quote".
- option_ref: 1/2/3 if user says "Option 1/2/3".
- resolve_from_history: true whenever the message only makes sense with prior context.

SKU KNOWLEDGE:
Valid Meraki families: MR (APs), MX (firewalls), MS (switches), MV (cameras), MT (sensors), MG (cellular), Z (teleworker), CW (Wi-Fi 6E/7).
Bare license SKUs like "LIC-ENT-3YR","LIC-MX64-SEC-3YR" \u2192 items with sku_type="license".
Cisco SME licenses (Systems Manager): "SME license", "SME liscense", "SME", "Systems Manager", and "Systems Manager license" when used as a license request are quote requests for LIC-SME with sku_type="license". If multiple terms are named, set modifiers.all_terms=true. Example: "SME license, 1yr and 3yr" \u2192 intent="quote", items=[{sku:"LIC-SME",qty:1,sku_type:"license"}], all_terms=true.
Cisco Duo licenses: format is LIC-DUO-{ESSENTIALS|ADVANTAGE|PREMIER}-{1|3|5}YR. Examples: "duo essentials 3 year" \u2192 LIC-DUO-ESSENTIALS-3YR; "duo advantage" \u2192 LIC-DUO-ADVANTAGE-{term}YR; "duo premier" \u2192 LIC-DUO-PREMIER-{term}YR. NEVER emit short forms like "DUO-E-3YR", "DUO-A", or "DUO-ESS" \u2014 always the full LIC-DUO-{TIER}-{TERM}YR string. If you aren't sure of the exact canonical SKU, leave items[] empty (the backend will resolve it) rather than hallucinating a short form.
Cisco Umbrella licenses: format is LIC-UMB-{DNS|SIG}-{ESS|ADV}-K9-{1|3|5}YR. Examples: "umbrella DNS essentials 3 year" \u2192 LIC-UMB-DNS-ESS-K9-3YR; "umbrella SIG advantage" \u2192 LIC-UMB-SIG-ADV-K9-{term}YR. NEVER emit short forms like "UMB-DNS-3YR" \u2014 always include -K9- and the full LIC-UMB-{TYPE}-{TIER}-K9-{TERM}YR format.
Cisco AnyConnect / Cisco Secure Client / Cisco VPN licenses: format is LIC-L-AC-{APX|PLS}-{1|3|5}Y-S1 (note: -Y suffix, NOT -YR, and -S1 is required). Two tiers: APX (Apex, full-featured) and PLS (Plus, baseline). 25-user MINIMUM qty \u2014 if user states qty < 25, still emit the item (backend clamps to 25 and warns). When the user says "AnyConnect", "Any Connect", "Cisco Secure Client", "Secure Client", or "Cisco VPN" WITHOUT naming a tier, emit BOTH tiers and set separate_quotes=true so the user can compare. When a tier IS named ("AnyConnect Plus", "Apex", "Cisco VPN Premier/Advantage" \u2014 note there is NO Premier/Advantage for AnyConnect, only APX/PLS), emit only that tier. Examples: "10 AnyConnect Plus" \u2192 items=[{sku:"LIC-L-AC-PLS-1Y-S1",qty:10,sku_type:"license"},{sku:"LIC-L-AC-PLS-3Y-S1",qty:10,sku_type:"license"},{sku:"LIC-L-AC-PLS-5Y-S1",qty:10,sku_type:"license"}]; "50 Cisco VPN" \u2192 6 items (APX + PLS \xD7 1Y/3Y/5Y) with separate_quotes=true; "AnyConnect Apex 3 year 100 users" \u2192 [{sku:"LIC-L-AC-APX-3Y-S1",qty:100,sku_type:"license"}]. CRITICAL: AnyConnect IS in our catalog \u2014 never classify AnyConnect/Secure Client/Cisco VPN messages as "conversation" or tell the user we don't sell it.

CRITICAL \u2014 "ALL DUO" / "ALL UMBRELLA" expansion:
When the user says "all duo" / "all duo licenses" / "all duo quotes" / "every duo tier" (case-insensitive, with or without "cisco"), intent="quote" and items[] must expand to ALL three Duo tiers at the user-stated term (or all three terms when no term stated). Set modifiers.separate_quotes=true \u2014 the user wants one URL per tier/item. Default qty=1 unless user states a number.
  * "all duo licenses" (no term) \u2192 items = 9 entries: LIC-DUO-{ESSENTIALS|ADVANTAGE|PREMIER}-{1|3|5}YR (qty=1 each), separate_quotes=true
  * "all duo licenses as separate links" \u2192 same 9 entries, separate_quotes=true
  * "50 of all duo 3 year" \u2192 3 entries: LIC-DUO-{ESSENTIALS|ADVANTAGE|PREMIER}-3YR qty=50 each, separate_quotes=true
Same rule for "all umbrella" / "all umbrella licenses" \u2014 expand to all 4 type\xD7tier combos (LIC-UMB-{DNS|SIG}-{ESS|ADV}-K9-{term}YR) at the stated term (or all 3 terms = 12 combos when no term stated), separate_quotes=true.
NEVER collapse "all duo" to a single tier or "all umbrella" to a single type. NEVER classify "all duo" / "all umbrella" as clarify \u2014 the user is being explicit, they want every tier priced.

If a model looks valid but you don't recognize it (EOL or new), still emit as quote \u2014 the backend validates.
Word numbers: "one"=1,"two"=2,...,"ten"=10,"a couple"=2,"a few"=3.

Return ONLY the JSON object. No markdown fences. No explanation.`;
async function classifyWithCFv2(userMessage, priorContext, env) {
  if (!env.AI) return null;
  const startMs = Date.now();
  try {
    const userText = priorContext ? `Prior assistant context:
${priorContext}

User message:
${userMessage}` : userMessage;
    const result = await Promise.race([
      env.AI.run(CF_MODEL, {
        messages: [
          { role: "system", content: CF_CLASSIFIER_PROMPT_V2 },
          { role: "user", content: userText }
        ],
        max_tokens: 512
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("V2_TIMEOUT")), 8e3))
    ]);
    const elapsed = Date.now() - startMs;
    const rawResponse = result?.response ?? result?.choices?.[0]?.message?.content;
    if (typeof rawResponse === "object" && rawResponse !== null && rawResponse.intent) {
      return { ...rawResponse, elapsed, raw: JSON.stringify(rawResponse) };
    }
    const raw = typeof rawResponse === "string" ? rawResponse.trim() : String(rawResponse || "");
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { elapsed, raw, parseError: "no JSON found" };
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return { ...parsed, elapsed, raw };
    } catch (e) {
      return { elapsed, raw, parseError: e.message };
    }
  } catch (err) {
    return { elapsed: Date.now() - startMs, error: err.message };
  }
}
__name(classifyWithCFv2, "classifyWithCFv2");
var GEMMA4_MODEL = "@cf/google/gemma-4-26b-a4b-it";
async function classifyWithGemma4(userMessage, priorContext, env) {
  if (!env.AI) return null;
  const startMs = Date.now();
  try {
    const userText = priorContext ? `Prior assistant context:
${priorContext}

User message:
${userMessage}` : userMessage;
    const result = await Promise.race([
      env.AI.run(GEMMA4_MODEL, {
        messages: [
          { role: "system", content: CF_CLASSIFIER_PROMPT_V2 },
          { role: "user", content: userText }
        ],
        max_completion_tokens: 4096,
        thinking: { type: "disabled" }
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("GEMMA4_TIMEOUT")), 1e4))
    ]);
    const elapsed = Date.now() - startMs;
    const rawResponse = result?.choices?.[0]?.message?.content ?? result?.response;
    if (typeof rawResponse === "object" && rawResponse !== null && rawResponse.intent) {
      return { ...rawResponse, elapsed, raw: JSON.stringify(rawResponse) };
    }
    const raw = typeof rawResponse === "string" ? rawResponse.trim() : String(rawResponse || "");
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { elapsed, raw, parseError: "no JSON found" };
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return { ...parsed, elapsed, raw };
    } catch (e) {
      return { elapsed, raw, parseError: e.message };
    }
  } catch (err) {
    return { elapsed: Date.now() - startMs, error: err.message };
  }
}
__name(classifyWithGemma4, "classifyWithGemma4");
async function classifyWithV3Shadow(userMessage, priorContext, env) {
  if (!env.AI) return null;
  const startMs = Date.now();
  try {
    const userText = priorContext ? `Prior assistant context:
${priorContext}

User message:
${userMessage}` : userMessage;
    const result = await Promise.race([
      env.AI.run(CF_MODEL, {
        messages: [
          { role: "system", content: CF_CLASSIFIER_PROMPT_V3 },
          { role: "user", content: userText }
        ],
        max_tokens: 512
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("V3_TIMEOUT")), 8e3))
    ]);
    const elapsed = Date.now() - startMs;
    const rawResponse = result?.response ?? result?.choices?.[0]?.message?.content;
    if (typeof rawResponse === "object" && rawResponse !== null && rawResponse.intent) {
      return { ...rawResponse, elapsed, raw: JSON.stringify(rawResponse) };
    }
    const raw = typeof rawResponse === "string" ? rawResponse.trim() : String(rawResponse || "");
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { elapsed, raw, parseError: "no JSON found" };
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return { ...parsed, elapsed, raw };
    } catch (e) {
      return { elapsed, raw, parseError: e.message };
    }
  } catch (err) {
    return { elapsed: Date.now() - startMs, error: err.message };
  }
}
__name(classifyWithV3Shadow, "classifyWithV3Shadow");
var ROUTING_AMBIGUOUS_STEM = /^(MS125-24|MS125-48|MS130-24|MS130-48|MS150-24|MS150-48|MS210-24|MS210-48|MS225-24|MS225-48|MS250-24|MS250-48|MS350-24|MS350-48|MS390-24|MS390-48|MS130|MS150|MS250|MS350|MS390|MS425|MR|MX|MV|MT|MG|CW)$/i;
var ROUTING_AMBIGUOUS_TEXT_STEM = /\b(MS125-24|MS125-48|MS130-24|MS130-48|MS150-24|MS150-48|MS210-24|MS210-48|MS225-24|MS225-48|MS250-24|MS250-48|MS350-24|MS350-48|MS390-24|MS390-48|MS130|MS150|MS250|MS350|MS390|MS425|MR|MX|MV|MT|MG|CW)\b(?![A-Z0-9-])/i;
function getClassifierItems(v2) {
  return Array.isArray(v2?.items) ? v2.items : [];
}
__name(getClassifierItems, "getClassifierItems");
function classifierHasAmbiguousStem(v2) {
  return getClassifierItems(v2).some((i) => i && typeof i.sku === "string" && ROUTING_AMBIGUOUS_STEM.test(i.sku.trim()));
}
__name(classifierHasAmbiguousStem, "classifierHasAmbiguousStem");
function buildClassifierClarifyReply(rawText, classification) {
  const text = typeof rawText === "string" ? rawText : "";
  const items = getClassifierItems(classification);
  const itemSku = items.map((i) => i && typeof i.sku === "string" ? i.sku.trim().toUpperCase() : "").find((sku) => ROUTING_AMBIGUOUS_STEM.test(sku));
  const rawSku = (text.match(ROUTING_AMBIGUOUS_TEXT_STEM) || [])[1];
  const ambiguousSku = itemSku || (rawSku ? rawSku.toUpperCase() : "");
  if (ambiguousSku) {
    if (/^MS125-24$/i.test(ambiguousSku)) {
      return "Which MS125-24 variant should I quote: MS125-24 or MS125-24P?";
    }
    if (/^MS125-48$/i.test(ambiguousSku)) {
      return "Which MS125-48 variant should I quote: MS125-48, MS125-48LP, or MS125-48FP?";
    }
    if (/^MS130-24$/i.test(ambiguousSku)) {
      return "Which MS130-24 variant should I quote: MS130-24, MS130-24P, or MS130-24X?";
    }
    if (/^MS130-48$/i.test(ambiguousSku)) {
      return "Which MS130-48 variant should I quote: MS130-48, MS130-48P, or MS130-48X?";
    }
    if (/^MS150-24$/i.test(ambiguousSku)) {
      return "Which MS150-24 variant should I quote: MS150-24T-4G, MS150-24T-4X, MS150-24P-4G, MS150-24P-4X, or MS150-24MP-4X?";
    }
    if (/^MS150-48$/i.test(ambiguousSku)) {
      return "Which MS150-48 variant should I quote: MS150-48T-4G, MS150-48T-4X, MS150-48LP-4G, MS150-48LP-4X, MS150-48FP-4G, MS150-48FP-4X, or MS150-48MP-4X?";
    }
    if (/^MS210-24$/i.test(ambiguousSku)) {
      return "Which MS210-24 variant should I quote: MS210-24 or MS210-24P?";
    }
    if (/^MS210-48$/i.test(ambiguousSku)) {
      return "Which MS210-48 variant should I quote: MS210-48, MS210-48LP, or MS210-48FP?";
    }
    if (/^MS225-24$/i.test(ambiguousSku)) {
      return "Which MS225-24 variant should I quote: MS225-24 or MS225-24P?";
    }
    if (/^MS225-48$/i.test(ambiguousSku)) {
      return "Which MS225-48 variant should I quote: MS225-48, MS225-48LP, or MS225-48FP?";
    }
    if (/^MS250-24$/i.test(ambiguousSku)) {
      return "Which MS250-24 variant should I quote: MS250-24 or MS250-24P?";
    }
    if (/^MS250-48$/i.test(ambiguousSku)) {
      return "Which MS250-48 variant should I quote: MS250-48 or MS250-48FP?";
    }
    if (/^MS350-24$/i.test(ambiguousSku)) {
      return "Which MS350-24 variant should I quote: MS350-24, MS350-24P, or MS350-24X?";
    }
    if (/^MS350-48$/i.test(ambiguousSku)) {
      return "Which MS350-48 variant should I quote: MS350-48, MS350-48FP, or MS350-48LP?";
    }
    if (/^MS390-24$/i.test(ambiguousSku)) {
      return "Which MS390-24 variant should I quote: MS390-24P, MS390-24U, or MS390-24UX?";
    }
    if (/^MS390-48$/i.test(ambiguousSku)) {
      return "Which MS390-48 variant should I quote: MS390-48P, MS390-48U, MS390-48UX, or MS390-48UX2?";
    }
    if (/^MS/i.test(ambiguousSku)) {
      return "Which exact switch model should I quote? Please include the full model and variant, such as MS130-24P or MS150-24P-4G.";
    }
  }
  const genericQuote = /\b(quote|price|pricing|cost|how\s+much|show\s+me|get\s+me|give\s+me|need|want|looking\s+for)\b/i.test(text);
  if (genericQuote && /\bswitch(?:es)?\b/i.test(text) && !/\b(MS\d{2,4}|C9\d{3}|C8\d{3})/i.test(text)) {
    return "Which switch model should I quote? Common options are MS130-24P, MS130-24X, MS150-24P-4G, and MS150-24P-4X.";
  }
  if (genericQuote && /\b(AP|APs|access\s+points?|wireless)\b/i.test(text) && !/\b(MR\d{2,4}|CW\d{4,5})\b/i.test(text)) {
    return "Which AP model should I quote? Common options are MR44, MR46, MR57, CW9164, CW9166, and CW9172I.";
  }
  if (genericQuote && items.length === 0 && /\b(price|pricing|cost|how\s+much)\b/i.test(text)) {
    return "Which SKU or product should I price?";
  }
  return null;
}
__name(buildClassifierClarifyReply, "buildClassifierClarifyReply");
function shouldTreatNoPriorReviseAsFreshQuote(v2, rawText) {
  const items = getClassifierItems(v2);
  if (items.length === 0) return false;
  const text = typeof rawText === "string" ? rawText : "";
  const freshQuoteLanguage = /\b(just\s+show|show\s+me|quote|price|pricing|cost|how\s+much|get\s+me|give\s+me|send\s+me|need|want|looking\s+for|renewal|renew|license|licenses)\b/i.test(text);
  const editLanguage = /\b(add|remove|delete|swap|replace|change|revise|modify|update|instead|make\s+it|bump|drop|same|previous|that|this|option)\b/i.test(text);
  return freshQuoteLanguage && !editLanguage;
}
__name(shouldTreatNoPriorReviseAsFreshQuote, "shouldTreatNoPriorReviseAsFreshQuote");
function normalizeV2ClassifierForRouting(v2, rawText, hasPriorCtx) {
  if (!v2 || typeof v2 !== "object" || !v2.intent) return v2;
  const intent = String(v2.intent).toLowerCase();
  const items = getClassifierItems(v2);
  const clarifyReply = buildClassifierClarifyReply(rawText, v2);
  if (intent === "quote" && clarifyReply && (items.length === 0 || classifierHasAmbiguousStem(v2))) {
    return {
      ...v2,
      intent: "clarify",
      reply: clarifyReply,
      confidence: 1,
      _deterministicRouting: classifierHasAmbiguousStem(v2) ? "deterministic-guard-ambig-stem" : "deterministic-guard-empty-items"
    };
  }
  if (intent === "revise" && !hasPriorCtx && shouldTreatNoPriorReviseAsFreshQuote(v2, rawText)) {
    return {
      ...v2,
      intent: "quote",
      confidence: Math.max(Number(v2.confidence) || 0, 0.9),
      revision: { action: null, target_sku: null, add_items: [], new_term: null, new_tier: null, new_qty: null, hw_lic_toggle: null },
      reference: { is_pronoun_ref: false, option_ref: null, resolve_from_history: false },
      _deterministicRouting: "deterministic-guard-revise-to-quote"
    };
  }
  return v2;
}
__name(normalizeV2ClassifierForRouting, "normalizeV2ClassifierForRouting");
var DEEPSEEK_MODEL_IDS = /* @__PURE__ */ new Set(["deepseek-v4-pro", "deepseek-v4-flash"]);
var DEEPSEEK_COST_PER_1M = {
  "deepseek-v4-pro": { inputCacheMiss: 1.74, inputCacheHit: 0.145, output: 3.48 },
  "deepseek-v4-flash": { inputCacheMiss: 0.14, inputCacheHit: 0.028, output: 0.28 }
};
function isDeepSeekModel(model) {
  return DEEPSEEK_MODEL_IDS.has(String(model || "").toLowerCase());
}
__name(isDeepSeekModel, "isDeepSeekModel");
var REASONING_POLICY_DISABLED = "disabled";
var REASONING_POLICY_UNSUPPORTED = "unsupported";
var REASONING_POLICY_ENABLED_ABLATION = "enabled_ablation";
var REASONING_POLICY_UNKNOWN = "unknown";
function normalizeReasoningPolicy(policy) {
  const normalized = String(policy || REASONING_POLICY_DISABLED).trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "enabled" || normalized === "reasoning" || normalized === "on" || normalized === "enabled_ablation") {
    return REASONING_POLICY_ENABLED_ABLATION;
  }
  if (normalized === REASONING_POLICY_UNSUPPORTED) return REASONING_POLICY_UNSUPPORTED;
  if (normalized === REASONING_POLICY_UNKNOWN) return REASONING_POLICY_UNKNOWN;
  return REASONING_POLICY_DISABLED;
}
__name(normalizeReasoningPolicy, "normalizeReasoningPolicy");
function getReasoningControl(modelId, requestedPolicy = REASONING_POLICY_DISABLED) {
  const reasoningPolicy = normalizeReasoningPolicy(requestedPolicy);
  const id = String(modelId || "").toLowerCase();
  if (reasoningPolicy === REASONING_POLICY_ENABLED_ABLATION) {
    return {
      reasoningPolicy: REASONING_POLICY_ENABLED_ABLATION,
      reasoningDisableSupported: false,
      requestOptions: {},
      reasoningControl: "reasoning_enabled_ablation"
    };
  }
  if (isDeepSeekModel(modelId)) {
    return {
      reasoningPolicy: REASONING_POLICY_DISABLED,
      reasoningDisableSupported: true,
      requestOptions: { thinking: { type: "disabled" } },
      reasoningControl: "deepseek_thinking_disabled"
    };
  }
  if (/gemma-4|gemma4/.test(id)) {
    return {
      reasoningPolicy: REASONING_POLICY_DISABLED,
      reasoningDisableSupported: true,
      requestOptions: { thinking: { type: "disabled" } },
      reasoningControl: "cf_thinking_disabled"
    };
  }
  if (/kimi-k2\.6|kimi/.test(id)) {
    return {
      reasoningPolicy: REASONING_POLICY_DISABLED,
      reasoningDisableSupported: true,
      requestOptions: { chat_template_kwargs: { thinking: { type: "disabled" } } },
      reasoningControl: "cf_chat_template_thinking_disabled"
    };
  }
  if (/nemotron|gpt-oss|qwen|qwq|mistral|llama|sea-lion|sealion|hermes/.test(id)) {
    return {
      reasoningPolicy: REASONING_POLICY_UNSUPPORTED,
      reasoningDisableSupported: false,
      requestOptions: {},
      reasoningControl: "disable_not_supported_or_not_verified"
    };
  }
  return {
    reasoningPolicy: REASONING_POLICY_UNKNOWN,
    reasoningDisableSupported: false,
    requestOptions: {},
    reasoningControl: "unknown_model"
  };
}
__name(getReasoningControl, "getReasoningControl");
function isReasoningControlRejection(error) {
  const text = String(error?.message || error || "");
  return /(thinking|reasoning|chat_template_kwargs|enable_thinking|unknown.*(field|parameter)|invalid.*(field|parameter)|unexpected.*(field|parameter)|schema)/i.test(text);
}
__name(isReasoningControlRejection, "isReasoningControlRejection");
function applyReasoningRequestOptions(requestBody, reasoningControl) {
  const options = reasoningControl?.requestOptions || {};
  for (const [key, value] of Object.entries(options)) requestBody[key] = value;
}
__name(applyReasoningRequestOptions, "applyReasoningRequestOptions");
function reasoningResultFields(reasoningControl) {
  const policy = reasoningControl?.reasoningPolicy || REASONING_POLICY_UNKNOWN;
  const disableSupported = reasoningControl?.reasoningDisableSupported === true;
  return {
    reasoningPolicy: policy,
    reasoning_policy: policy,
    reasoningDisableSupported: disableSupported,
    reasoning_disable_supported: disableSupported,
    reasoningControl: reasoningControl?.reasoningControl || null,
    reasoning_control: reasoningControl?.reasoningControl || null
  };
}
__name(reasoningResultFields, "reasoningResultFields");
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
__name(sleep, "sleep");
async function fetchWithTimeout(url, options, timeoutMs = 45e3) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}
__name(fetchWithTimeout, "fetchWithTimeout");
function extractJsonFromText(raw) {
  if (typeof raw === "object" && raw !== null) return { parsed: raw, raw: JSON.stringify(raw), parseError: null };
  const text = typeof raw === "string" ? raw.trim() : String(raw || "");
  if (!text) return { parsed: null, raw: text, parseError: "empty response" };
  try {
    return { parsed: JSON.parse(text), raw: text, parseError: null };
  } catch (_) {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return { parsed: null, raw: text, parseError: "no JSON found" };
    try {
      return { parsed: JSON.parse(m[0]), raw: text, parseError: null };
    } catch (e) {
      return { parsed: null, raw: text, parseError: e.message };
    }
  }
}
__name(extractJsonFromText, "extractJsonFromText");
function estimateDeepSeekCostUsd(model, usage = {}) {
  const price = DEEPSEEK_COST_PER_1M[String(model || "").toLowerCase()] || DEEPSEEK_COST_PER_1M["deepseek-v4-pro"];
  const promptTokens = usage.prompt_tokens || usage.input_tokens || 0;
  const completionTokens = usage.completion_tokens || usage.output_tokens || 0;
  const cacheHitTokens = usage.prompt_cache_hit_tokens || 0;
  const cacheMissTokens = usage.prompt_cache_miss_tokens || Math.max(0, promptTokens - cacheHitTokens);
  return cacheMissTokens / 1e6 * price.inputCacheMiss + cacheHitTokens / 1e6 * price.inputCacheHit + completionTokens / 1e6 * price.output;
}
__name(estimateDeepSeekCostUsd, "estimateDeepSeekCostUsd");
async function callDeepSeekChatCompletion(env, {
  model,
  systemPrompt,
  userText,
  thinkingType = "disabled",
  jsonMode = true,
  maxTokens = 4096,
  reasoningPolicy = REASONING_POLICY_DISABLED
}) {
  if (!env.DEEPSEEK_API_KEY) {
    return { error: "DEEPSEEK_API_KEY not bound", status: 500, attempts: 0, transientErrors: [], shouldFallbackToClaude: false, reasoningPolicy: REASONING_POLICY_UNKNOWN, reasoningDisableSupported: false };
  }
  const reasoningControl = getReasoningControl(model, reasoningPolicy);
  const effectiveThinkingType = reasoningControl.reasoningPolicy === REASONING_POLICY_ENABLED_ABLATION ? "enabled" : thinkingType;
  const requestBody = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userText }
    ],
    max_tokens: maxTokens,
    thinking: { type: effectiveThinkingType },
    stream: false
  };
  if (jsonMode) requestBody.response_format = { type: "json_object" };
  const transientErrors = [];
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await fetchWithTimeout(DEEPSEEK_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify(requestBody)
      });
      const text = await resp.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch (_) {
      }
      if (resp.ok) {
        const message = data?.choices?.[0]?.message || {};
        const raw = message.content ?? "";
        return {
          model,
          status: resp.status,
          attempts: attempt,
          transientErrors,
          rawResult: data,
          raw,
          reasoningContent: message.reasoning_content || null,
          usage: data?.usage || {},
          costUsd: estimateDeepSeekCostUsd(model, data?.usage || {}),
          ...reasoningResultFields(reasoningControl)
        };
      }
      const error = `DeepSeek ${resp.status}: ${text.substring(0, 500)}`;
      if ((resp.status === 429 || resp.status >= 500) && attempt < maxAttempts) {
        transientErrors.push(error);
        const retryAfter = Number(resp.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1e3 : 500 * Math.pow(2, attempt - 1));
        continue;
      }
      return {
        error,
        status: resp.status,
        attempts: attempt,
        transientErrors,
        rawResult: data || text,
        usage: data?.usage || {},
        costUsd: estimateDeepSeekCostUsd(model, data?.usage || {}),
        shouldFallbackToClaude: resp.status >= 500,
        ...reasoningResultFields(reasoningControl)
      };
    } catch (e) {
      const error = `DeepSeek fetch error: ${e.message}`;
      if (attempt < maxAttempts) {
        transientErrors.push(error);
        await sleep(500 * Math.pow(2, attempt - 1));
        continue;
      }
      return { error, status: 0, attempts: attempt, transientErrors, shouldFallbackToClaude: false, ...reasoningResultFields(reasoningControl) };
    }
  }
}
__name(callDeepSeekChatCompletion, "callDeepSeekChatCompletion");
async function callClaudeClassifierJsonFallback(env, { systemPrompt, userText }) {
  if (!env.ANTHROPIC_API_KEY) {
    return { error: "ANTHROPIC_API_KEY not bound", model: "claude-sonnet-4-6", attempts: 0, usage: {}, costUsd: 0 };
  }
  try {
    const resp = await fetchWithTimeout(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        system: `${systemPrompt}

Return valid JSON only.`,
        messages: [{ role: "user", content: userText }]
      })
    });
    const text = await resp.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
    }
    if (!resp.ok) return { error: `Anthropic ${resp.status}: ${text.substring(0, 500)}`, model: "claude-sonnet-4-6", attempts: 1, rawResult: data || text, usage: {}, costUsd: 0 };
    const raw = (data?.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    const usage = data?.usage || {};
    const costUsd = (usage.input_tokens || 0) / 1e6 * 3 + (usage.output_tokens || 0) / 1e6 * 15;
    return { model: "claude-sonnet-4-6", attempts: 1, rawResult: data, raw, usage, costUsd };
  } catch (e) {
    return { error: e.message, model: "claude-sonnet-4-6", attempts: 1, usage: {}, costUsd: 0 };
  }
}
__name(callClaudeClassifierJsonFallback, "callClaudeClassifierJsonFallback");
async function logShadowClassification(env, { personId, requestText, priorContext, legacy, v2, gemma4, v3 }) {
  if (!env.ANALYTICS_DB) return;
  try {
    if (!globalThis.__shadowTableReady) {
      await env.ANALYTICS_DB.prepare(`CREATE TABLE IF NOT EXISTS classifier_shadow (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT DEFAULT (datetime('now')),
        person_id TEXT,
        request_text TEXT,
        prior_context TEXT,
        legacy_intent TEXT,
        legacy_elapsed_ms INTEGER,
        legacy_raw TEXT,
        v2_intent TEXT,
        v2_confidence REAL,
        v2_elapsed_ms INTEGER,
        v2_items TEXT,
        v2_modifiers TEXT,
        v2_revision TEXT,
        v2_reference TEXT,
        v2_raw TEXT,
        v2_parse_error TEXT,
        intent_agree INTEGER,
        gemma4_intent TEXT,
        gemma4_confidence REAL,
        gemma4_elapsed_ms INTEGER,
        gemma4_items TEXT,
        gemma4_modifiers TEXT,
        gemma4_revision TEXT,
        gemma4_reference TEXT,
        gemma4_raw TEXT,
        gemma4_parse_error TEXT,
        gemma4_agree INTEGER,
        v3_intent TEXT,
        v3_confidence REAL,
        v3_elapsed_ms INTEGER,
        v3_items TEXT,
        v3_modifiers TEXT,
        v3_revision TEXT,
        v3_reference TEXT,
        v3_raw TEXT,
        v3_parse_error TEXT,
        v3_agree INTEGER
      )`).run();
      try {
        await env.ANALYTICS_DB.prepare(`ALTER TABLE classifier_shadow ADD COLUMN gemma4_intent TEXT`).run();
      } catch {
      }
      try {
        await env.ANALYTICS_DB.prepare(`ALTER TABLE classifier_shadow ADD COLUMN gemma4_confidence REAL`).run();
      } catch {
      }
      try {
        await env.ANALYTICS_DB.prepare(`ALTER TABLE classifier_shadow ADD COLUMN gemma4_elapsed_ms INTEGER`).run();
      } catch {
      }
      try {
        await env.ANALYTICS_DB.prepare(`ALTER TABLE classifier_shadow ADD COLUMN gemma4_items TEXT`).run();
      } catch {
      }
      try {
        await env.ANALYTICS_DB.prepare(`ALTER TABLE classifier_shadow ADD COLUMN gemma4_modifiers TEXT`).run();
      } catch {
      }
      try {
        await env.ANALYTICS_DB.prepare(`ALTER TABLE classifier_shadow ADD COLUMN gemma4_revision TEXT`).run();
      } catch {
      }
      try {
        await env.ANALYTICS_DB.prepare(`ALTER TABLE classifier_shadow ADD COLUMN gemma4_reference TEXT`).run();
      } catch {
      }
      try {
        await env.ANALYTICS_DB.prepare(`ALTER TABLE classifier_shadow ADD COLUMN gemma4_raw TEXT`).run();
      } catch {
      }
      try {
        await env.ANALYTICS_DB.prepare(`ALTER TABLE classifier_shadow ADD COLUMN gemma4_parse_error TEXT`).run();
      } catch {
      }
      try {
        await env.ANALYTICS_DB.prepare(`ALTER TABLE classifier_shadow ADD COLUMN gemma4_agree INTEGER`).run();
      } catch {
      }
      try {
        await env.ANALYTICS_DB.prepare(`ALTER TABLE classifier_shadow ADD COLUMN v3_intent TEXT`).run();
      } catch {
      }
      try {
        await env.ANALYTICS_DB.prepare(`ALTER TABLE classifier_shadow ADD COLUMN v3_confidence REAL`).run();
      } catch {
      }
      try {
        await env.ANALYTICS_DB.prepare(`ALTER TABLE classifier_shadow ADD COLUMN v3_elapsed_ms INTEGER`).run();
      } catch {
      }
      try {
        await env.ANALYTICS_DB.prepare(`ALTER TABLE classifier_shadow ADD COLUMN v3_items TEXT`).run();
      } catch {
      }
      try {
        await env.ANALYTICS_DB.prepare(`ALTER TABLE classifier_shadow ADD COLUMN v3_modifiers TEXT`).run();
      } catch {
      }
      try {
        await env.ANALYTICS_DB.prepare(`ALTER TABLE classifier_shadow ADD COLUMN v3_revision TEXT`).run();
      } catch {
      }
      try {
        await env.ANALYTICS_DB.prepare(`ALTER TABLE classifier_shadow ADD COLUMN v3_reference TEXT`).run();
      } catch {
      }
      try {
        await env.ANALYTICS_DB.prepare(`ALTER TABLE classifier_shadow ADD COLUMN v3_raw TEXT`).run();
      } catch {
      }
      try {
        await env.ANALYTICS_DB.prepare(`ALTER TABLE classifier_shadow ADD COLUMN v3_parse_error TEXT`).run();
      } catch {
      }
      try {
        await env.ANALYTICS_DB.prepare(`ALTER TABLE classifier_shadow ADD COLUMN v3_agree INTEGER`).run();
      } catch {
      }
      globalThis.__shadowTableReady = true;
    }
    const intentAgree = legacy?.intent && v2?.intent ? String(legacy.intent).toLowerCase() === String(v2.intent).toLowerCase() ? 1 : 0 : null;
    const gemma4Agree = legacy?.intent && gemma4?.intent ? String(legacy.intent).toLowerCase() === String(gemma4.intent).toLowerCase() ? 1 : 0 : null;
    const v3Agree = legacy?.intent && v3?.intent ? String(legacy.intent).toLowerCase() === String(v3.intent).toLowerCase() ? 1 : 0 : null;
    await env.ANALYTICS_DB.prepare(`INSERT INTO classifier_shadow
      (person_id, request_text, prior_context, legacy_intent, legacy_elapsed_ms, legacy_raw, v2_intent, v2_confidence, v2_elapsed_ms, v2_items, v2_modifiers, v2_revision, v2_reference, v2_raw, v2_parse_error, intent_agree, gemma4_intent, gemma4_confidence, gemma4_elapsed_ms, gemma4_items, gemma4_modifiers, gemma4_revision, gemma4_reference, gemma4_raw, gemma4_parse_error, gemma4_agree, v3_intent, v3_confidence, v3_elapsed_ms, v3_items, v3_modifiers, v3_revision, v3_reference, v3_raw, v3_parse_error, v3_agree)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      personId || null,
      String(requestText || "").substring(0, 1e3),
      String(priorContext || "").substring(0, 2e3),
      legacy?.intent || null,
      legacy?.elapsed || null,
      String(legacy?.raw || "").substring(0, 2e3),
      v2?.intent || null,
      v2?.confidence || null,
      v2?.elapsed || null,
      v2?.items ? JSON.stringify(v2.items).substring(0, 1e3) : null,
      v2?.modifiers ? JSON.stringify(v2.modifiers).substring(0, 500) : null,
      v2?.revision ? JSON.stringify(v2.revision).substring(0, 500) : null,
      v2?.reference ? JSON.stringify(v2.reference).substring(0, 200) : null,
      String(v2?.raw || "").substring(0, 2e3),
      v2?.parseError || v2?.error || null,
      intentAgree,
      gemma4?.intent || null,
      gemma4?.confidence || null,
      gemma4?.elapsed || null,
      gemma4?.items ? JSON.stringify(gemma4.items).substring(0, 1e3) : null,
      gemma4?.modifiers ? JSON.stringify(gemma4.modifiers).substring(0, 500) : null,
      gemma4?.revision ? JSON.stringify(gemma4.revision).substring(0, 500) : null,
      gemma4?.reference ? JSON.stringify(gemma4.reference).substring(0, 200) : null,
      String(gemma4?.raw || "").substring(0, 2e3),
      gemma4?.parseError || gemma4?.error || null,
      gemma4Agree,
      v3?.intent || null,
      v3?.confidence || null,
      v3?.elapsed || null,
      v3?.items ? JSON.stringify(v3.items).substring(0, 1e3) : null,
      v3?.modifiers ? JSON.stringify(v3.modifiers).substring(0, 500) : null,
      v3?.revision ? JSON.stringify(v3.revision).substring(0, 500) : null,
      v3?.reference ? JSON.stringify(v3.reference).substring(0, 200) : null,
      String(v3?.raw || "").substring(0, 2e3),
      v3?.parseError || v3?.error || null,
      v3Agree
    ).run();
  } catch (e) {
    console.warn("[Shadow] log failed:", e.message);
  }
}
__name(logShadowClassification, "logShadowClassification");
async function classifyWithCF(userMessage, env) {
  if (!env.AI) return null;
  const startMs = Date.now();
  try {
    const result = await Promise.race([
      env.AI.run(CF_MODEL, {
        messages: [
          { role: "system", content: CF_CLASSIFIER_PROMPT },
          { role: "user", content: userMessage }
        ],
        max_tokens: 256
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), 8e3))
    ]);
    const elapsed = Date.now() - startMs;
    const rawResponse = result?.response ?? result?.choices?.[0]?.message?.content;
    if (typeof rawResponse === "object" && rawResponse !== null && rawResponse.intent) {
      console.log(`[CF-Classify] Pre-parsed object (${elapsed}ms): intent=${rawResponse.intent}`);
      return { ...rawResponse, elapsed, raw: JSON.stringify(rawResponse) };
    }
    const raw = typeof rawResponse === "string" ? rawResponse.trim() : String(rawResponse || "");
    console.log(`[CF-Classify] Raw response (${elapsed}ms): ${raw.substring(0, 200)}`);
    let jsonStr = raw;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];
    const parsed = JSON.parse(jsonStr);
    return { ...parsed, elapsed, raw };
  } catch (err) {
    console.error(`[CF-Classify] Error: ${err.message} (${Date.now() - startMs}ms)`);
    return null;
  }
}
__name(classifyWithCF, "classifyWithCF");
async function askCFConversation(userMessage, env) {
  if (!env.AI) return null;
  const startMs = Date.now();
  try {
    const result = await Promise.race([
      env.AI.run(CF_MODEL, {
        messages: [
          { role: "system", content: CF_CONVO_PROMPT },
          { role: "user", content: userMessage }
        ],
        max_tokens: 256
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), 1e4))
    ]);
    const elapsed = Date.now() - startMs;
    const response = extractAIResponse(result);
    if (response.length > 5) return { response, elapsed };
    return null;
  } catch (err) {
    console.error(`[CF-Convo] Error: ${err.message} (${Date.now() - startMs}ms)`);
    return null;
  }
}
__name(askCFConversation, "askCFConversation");
function isValidSkuToken(sku) {
  if (!sku) return false;
  const s = sku.toUpperCase();
  if (s.startsWith("LIC-")) return true;
  if (/^Z\d/.test(s) && !/^Z[134][C]?X?$/.test(s)) return false;
  if (/^[A-Z0-9]{4,}-[A-Z0-9]{4,}-[A-Z0-9]{4,}/.test(s)) return false;
  return true;
}
__name(isValidSkuToken, "isValidSkuToken");
function dedupeSkus(skus) {
  const map = /* @__PURE__ */ new Map();
  for (const { sku, qty } of skus) {
    map.set(sku, (map.get(sku) || 0) + qty);
  }
  return Array.from(map.entries()).map(([sku, qty]) => ({ sku, qty }));
}
__name(dedupeSkus, "dedupeSkus");
function collapseLicenseTermlessDuplicates(skus) {
  if (!Array.isArray(skus) || skus.length < 2) return skus;
  const termedStems = /* @__PURE__ */ new Set();
  for (const s of skus) {
    const m = String(s?.sku || "").toUpperCase().match(/^(LIC-.+?)-[135]YR?$/);
    if (m) termedStems.add(m[1]);
  }
  if (termedStems.size === 0) return skus;
  return skus.filter((s) => {
    const up = String(s?.sku || "").toUpperCase();
    if (!up.startsWith("LIC-")) return true;
    if (/-[135]YR?$/.test(up)) return true;
    return !termedStems.has(up);
  });
}
__name(collapseLicenseTermlessDuplicates, "collapseLicenseTermlessDuplicates");
function extractSkusFromVisionText(text) {
  const skus = [];
  if (!text) return skus;
  const cleanedText = text.replace(/\*{1,3}/g, "");
  if (/LICENSE_DASHBOARD_PARSE_V1/.test(cleanedText)) {
    const lineRe = /SKU:\s*([A-Z0-9][A-Z0-9_-]*)\s*\|\s*LIMIT:\s*(\d+)\s*\|\s*ACTIVE:\s*(\d+)/gi;
    let m;
    while ((m = lineRe.exec(cleanedText)) !== null) {
      const sku = m[1].toUpperCase().replace(/_/g, "-");
      const limit = parseInt(m[2], 10);
      const active = parseInt(m[3], 10);
      if (!Number.isFinite(limit) || !Number.isFinite(active)) continue;
      if (active === 0 && limit === 0) continue;
      if (active === 0) continue;
      const qty = Math.min(limit || active, active || limit);
      if (qty <= 0 || qty > 500) continue;
      if (!isValidSkuToken(sku)) continue;
      skus.push({ sku, qty });
    }
    if (!skus.some((s) => /^(SM|SME|SM-ENT)$/.test(s.sku))) {
      const smBlock = (cleanedText.match(/---\s*([\s\S]*?)\s*---/) || [, cleanedText])[1];
      const smM = smBlock.match(/Systems\s+Manager[^\n]*?LIMIT:\s*(\d+)[^\n]*?ACTIVE:\s*(\d+)/i);
      if (smM) {
        const smLimit = parseInt(smM[1], 10);
        const smActive = parseInt(smM[2], 10);
        const smQty = Math.min(smLimit || smActive, smActive || smLimit);
        if (smActive > 0 && smQty > 0 && smQty <= 500) skus.push({ sku: "SM-ENT", qty: smQty });
      }
    }
    if (skus.length > 0) return collapseLicenseTermlessDuplicates(dedupeSkus(skus));
  }
  const mrEntRe = /MR\s+Enterprise[^\n\d]{0,40}?(\d+)/gi;
  let mEnt;
  while ((mEnt = mrEntRe.exec(cleanedText)) !== null) {
    const qty = parseInt(mEnt[1], 10);
    if (qty > 0 && qty <= 500) skus.push({ sku: "MR-ENT", qty });
  }
  const skuRegex = /\b((?:LIC-[A-Z0-9-]+|(?:MR|MS|MX|MV|MT|MG|CW|C9|Z)\d[A-Z0-9-]*))\b/gi;
  const lines = cleanedText.split(/\n|\r/);
  for (const line of lines) {
    if (/license\s+history/i.test(line)) continue;
    if (/\b[A-Z0-9]{4,}-[A-Z0-9]{4,}-[A-Z0-9]{4,}\b/i.test(line)) continue;
    let match;
    skuRegex.lastIndex = 0;
    while ((match = skuRegex.exec(line)) !== null) {
      const sku = match[1].toUpperCase();
      if (!isValidSkuToken(sku)) continue;
      const beforeSku = line.substring(0, match.index);
      const afterSku = line.substring(match.index + match[0].length);
      let qty = 1;
      const afterQty = afterSku.match(/(?:\s*[\|:×x]\s*|\s+(?:has\s+a\s+)?count\s+of\s+|\s*\(\s*)(\d+)/i);
      if (afterQty) {
        qty = parseInt(afterQty[1], 10);
      } else {
        const beforeQty = beforeSku.match(/(?:^|[\s,|])(\d+)\s*[x×]?\s+$/i);
        if (beforeQty) {
          qty = parseInt(beforeQty[1], 10);
        }
      }
      if (qty > 0 && qty <= 500) {
        skus.push({ sku, qty });
      }
    }
  }
  return collapseLicenseTermlessDuplicates(dedupeSkus(skus));
}
__name(extractSkusFromVisionText, "extractSkusFromVisionText");
function getDashboardVisionPrompt() {
  return `You are analyzing a Cisco Meraki license dashboard screenshot.

Only extract rows from the TOP "License information" table \u2014 the one with the columns "License limit" and "Current device count". IGNORE the "License History" section at the bottom (those are past renewals with license keys like Z228-BEAC-D2QX and old devices \u2014 they must never appear in output).

Respond with ONLY this block. No preamble, no summary, no recommendations, no markdown bold, no explanations:

LICENSE_DASHBOARD_PARSE_V1
---
SKU: <sku> | LIMIT: <license limit number> | ACTIVE: <current device count number>
---
EXPIRATION: <YYYY-MM-DD or unknown>
MX_EDITION: <Advanced Security | Secure SD-WAN Plus | none>
MR_EDITION: <Enterprise | Advanced | none>

Hard rules:
1. One SKU per line between the --- markers. Emit a row for EVERY visible row in the top License table (including MR Enterprise, Systems Manager, MX models, MS models, MT, MV, MG, Z-series).
2. MR Enterprise rows MUST be emitted as: SKU: MR-ENT | LIMIT: <number> | ACTIVE: <number>
2b. Systems Manager rows (the row labeled "Systems Manager", often shown as "Enabled (paid)") MUST be emitted as: SKU: SM-ENT | LIMIT: <license limit number> | ACTIVE: <current device count number>. Use the exact integers from the License limit and Current device count columns. (Skip only if ACTIVE is 0, per rule 3.)
3. Skip a row ONLY when ACTIVE (Current device count) is 0. Example: "MT | 5 free | 0" \u2014 skip. Otherwise emit.
4. Do NOT invent, recommend, translate, or substitute SKUs. Only emit SKUs literally visible in the top License table.
5. NEVER drop a visible row whose ACTIVE >= 1. If a row is partially obscured by a colored annotation, read what is visible and emit it. Annotations (red/yellow/blue underlines, circles, crosses, highlighter strokes) are user markup \u2014 they are NOT table boundaries and they do NOT terminate the table.
6. KEEP READING the rows BELOW any colored marker stroke. Underlines and crosses commonly span between adjacent rows (e.g. between MX65 and MX85). Continue scanning all subsequent rows in the License information table until you reach the License History section.
7. Worked example: a dashboard listing "MX65 | 1 | 0" then "MX85 | 1 | 1" with a red underline crossing both rows must skip MX65 (ACTIVE=0) AND emit MX85 (ACTIVE=1). Never drop MX85 because of the annotation.
8. Do NOT include SKUs from the "License History" section (e.g. MX84 from a prior renewal).
9. LIMIT and ACTIVE must be the exact integers from the "License limit" and "Current device count" columns \u2014 never derive from model numbers.
10. Preserve hyphens exactly (MS120-24P, not MS120 24P).
11. Do not wrap labels in asterisks or other markdown. Output plain ASCII only.
12. If the table is genuinely empty after applying rules 3-8, emit the LICENSE_DASHBOARD_PARSE_V1 block with no SKU lines between the --- markers \u2014 but only after you have scanned every row top-to-bottom.`;
}
__name(getDashboardVisionPrompt, "getDashboardVisionPrompt");
function getDashboardVisionAuditPrompt(firstResponse) {
  const safeFirst = String(firstResponse || "").slice(0, 2e3);
  return `You already produced this LICENSE_DASHBOARD_PARSE_V1 output for the screenshot:

---FIRST PASS---
${safeFirst}
---END FIRST PASS---

Now re-scan the SAME image. Your job is to catch rows the first pass may have missed \u2014 especially rows whose ACTIVE >= 1 that sit just below or above a colored annotation (red/yellow/blue underline, cross, circle, highlighter stroke). Annotations are user markup, NOT table boundaries; the License information table continues below them.

Focus checks:
- For every MX, MR Enterprise, Systems Manager, MS, MT, MV, MG, Z, CW, or C9 row visible in the License information table with ACTIVE >= 1, confirm it is present in the first pass. (Systems Manager \u2192 SM-ENT.)
- If you see an MX65 row, also look immediately above and below it for an MX85, MX67, MX68, MX75, MX95, MX105, MX250, or MX450 row that the first pass may have skipped.
- Do not invent SKUs. Only confirm or add rows that are literally visible in the top License information table.

Respond with ONLY a fresh LICENSE_DASHBOARD_PARSE_V1 block in the same format as before, listing every row with ACTIVE >= 1 you can see. The caller will merge this with the first pass by taking the MAX qty per SKU (not the sum), so it is safe to repeat rows the first pass already had.`;
}
__name(getDashboardVisionAuditPrompt, "getDashboardVisionAuditPrompt");
function shouldAuditDashboardVision(firstResponse) {
  if (!firstResponse) return false;
  const skus = extractSkusFromVisionText(firstResponse);
  if (skus.length === 0) return false;
  const upper = /* @__PURE__ */ __name((s) => String(s.sku || "").toUpperCase(), "upper");
  const hasMrEnt = skus.some((s) => upper(s) === "MR-ENT" || upper(s) === "MR_ENT");
  const hasDeviceFamily = skus.some((s) => /^(MX|MS|MV|MG|Z|CW|C9)\d/i.test(upper(s)));
  if (hasMrEnt && !hasDeviceFamily) return true;
  const hasMx65 = skus.some((s) => /^MX65\b/i.test(upper(s)));
  const hasOtherMx = skus.some((s) => /^MX(?:67|68|75|85|95|105|250|450)\b/i.test(upper(s)));
  if (hasMx65 && !hasOtherMx) return true;
  return false;
}
__name(shouldAuditDashboardVision, "shouldAuditDashboardVision");
function mergeVisionSkusMax(first, audit) {
  const out = /* @__PURE__ */ new Map();
  const ingest = /* @__PURE__ */ __name((list) => {
    for (const it of list || []) {
      if (!it || !it.sku) continue;
      const sku = String(it.sku).toUpperCase();
      const qty = Number(it.qty) || 0;
      if (qty <= 0) continue;
      const prev = out.get(sku);
      if (!prev || qty > prev.qty) out.set(sku, { sku, qty });
    }
  }, "ingest");
  ingest(first);
  ingest(audit);
  return Array.from(out.values());
}
__name(mergeVisionSkusMax, "mergeVisionSkusMax");
function extractDashboardMetadata(text) {
  const out = { mxEdition: "", mrEdition: "", expiration: "" };
  if (!text) return out;
  const mx = String(text).match(/MX_EDITION:\s*([^\n]+)/i);
  const mr = String(text).match(/MR_EDITION:\s*([^\n]+)/i);
  const exp = String(text).match(/EXPIRATION:\s*([^\n]+)/i);
  if (mx) out.mxEdition = mx[1].trim();
  if (mr) out.mrEdition = mr[1].trim();
  if (exp) out.expiration = exp[1].trim();
  return out;
}
__name(extractDashboardMetadata, "extractDashboardMetadata");
function buildDashboardRenewalQuote(visionSkus, opts = {}) {
  const mxEditionRaw = String(opts.mxEdition || "").toUpperCase();
  const mxTier = /SDW|SD[-\s]*WAN/.test(mxEditionRaw) ? "SDW" : "SEC";
  const eolSwap = applyEolSwaps(visionSkus || [], opts.mxEdition);
  visionSkus = eolSwap.lines.filter((l) => l.valid !== false);
  const eolSwapNotes = [
    ...eolSwap.notes,
    ...eolSwap.lines.filter((l) => l.valid === false && l.flag).map((l) => `${l.sku}: ${l.flag}.`)
  ];
  const nonEolDevices = [];
  const eolDevices = [];
  const ordered = [];
  let mrEntQty = 0;
  let smEntQty = 0;
  for (const s of visionSkus || []) {
    if (!s || !s.sku || !(Number(s.qty) > 0)) continue;
    const upper = String(s.sku).toUpperCase();
    const qty = Math.floor(Number(s.qty));
    if (upper === "MR-ENT" || upper === "MR_ENT") {
      mrEntQty += qty;
      ordered.push({ kind: "mr", qty });
      continue;
    }
    if (upper === "SM-ENT" || upper === "SM_ENT" || upper === "SME" || upper === "SM") {
      smEntQty += qty;
      ordered.push({ kind: "sm", qty });
      continue;
    }
    const licSiblings = licenseTermSiblings(upper);
    if (licSiblings) {
      ordered.push({ kind: "lic", siblings: licSiblings, qty });
      continue;
    }
    if (upper.startsWith("LIC-")) continue;
    if (isEol(upper)) {
      const row = { model: upper, qty, replacement: checkEol(upper) };
      eolDevices.push(row);
      ordered.push({ kind: "eol", ...row });
    } else {
      nonEolDevices.push({ model: upper, qty });
      ordered.push({ kind: "device", model: upper, qty });
    }
  }
  const licFor = /* @__PURE__ */ __name((model, term) => {
    const lics = getLicenseSkus(model, mxTier);
    if (!lics) return null;
    return lics.find((l) => l.term === term) || null;
  }, "licFor");
  const TERMS = ["1Y", "3Y", "5Y"];
  const termYr = { "1Y": "1YR", "3Y": "3YR", "5Y": "5YR" };
  const empty = /* @__PURE__ */ __name(() => ({ "1Y": [], "3Y": [], "5Y": [] }), "empty");
  const renewItem = /* @__PURE__ */ __name((row, term) => {
    if (row.kind === "mr") return { sku: `LIC-ENT-${termYr[term]}`, qty: row.qty };
    if (row.kind === "sm") {
      return { sku: smeReplacementSku(parseInt(term, 10)), qty: row.qty };
    }
    if (row.kind === "lic") {
      const sku = row.siblings[term];
      return sku ? { sku, qty: row.qty } : null;
    }
    const lic = licFor(row.model, term);
    return lic ? { sku: lic.sku, qty: row.qty } : null;
  }, "renewItem");
  const option1 = empty();
  for (const term of TERMS) {
    for (const row of ordered) {
      const it = renewItem(row, term);
      if (it) option1[term].push(it);
    }
  }
  const buildRefresh = /* @__PURE__ */ __name((uplinkIdx) => {
    const groups = empty();
    for (const term of TERMS) {
      for (const row of ordered) {
        if (row.kind !== "eol") {
          const it = renewItem(row, term);
          if (it) groups[term].push(it);
          continue;
        }
        if (!row.replacement) continue;
        const replModel = Array.isArray(row.replacement) ? row.replacement[uplinkIdx] || row.replacement[0] : row.replacement;
        groups[term].push({ sku: applySuffix(replModel), qty: row.qty });
        const replLics = getLicenseSkus(replModel, mxTier);
        if (replLics) {
          const lic = replLics.find((l) => l.term === term);
          if (lic) groups[term].push({ sku: lic.sku, qty: row.qty });
        }
      }
    }
    return groups;
  }, "buildRefresh");
  const hasEol = eolDevices.length > 0;
  const hasAltUplink = eolDevices.some(
    (e) => Array.isArray(e.replacement) && e.replacement.length >= 2 && e.replacement[1] !== e.replacement[0]
  );
  const option2 = hasEol ? buildRefresh(0) : null;
  const option3 = hasEol && hasAltUplink ? buildRefresh(1) : null;
  const renderTerms = /* @__PURE__ */ __name((groups) => {
    const lines = [];
    let smeReplaced = false;
    for (const term of TERMS) {
      if (groups[term].length === 0) continue;
      const url = buildStratusUrl(groups[term]);
      const label = term === "1Y" ? "1-Year" : term === "3Y" ? "3-Year" : "5-Year";
      if (groups[term].some((i) => String(i.sku || "").toUpperCase().startsWith(SME_REPLACEMENT_BASE))) smeReplaced = true;
      lines.push(`${label} Co-Term: ${url}`);
    }
    if (smeReplaced) lines.push(`_${SME_EOL_FLAG}_`);
    return lines.join("\n\n");
  }, "renderTerms");
  let eolProse = "";
  if (eolDevices.length > 0) {
    const proseLines = ["**Products End of Life:**"];
    for (const { model, replacement } of eolDevices) {
      let line = `${model} (EOL) \u2192 `;
      if (Array.isArray(replacement) && replacement.length >= 2 && replacement[1] !== replacement[0]) {
        const parts = replacement.slice(0, 2).map((r, i) => `${r} (${i === 0 ? "1G" : "10G"})`);
        line += `Replacements: ${parts.join(" / ")}`;
      } else {
        const repl = Array.isArray(replacement) ? replacement[0] : replacement;
        line += repl ? `Replacement: ${repl}` : "Replacement: see Cisco for upgrade path";
      }
      proseLines.push(line);
    }
    eolProse = proseLines.join("\n");
  }
  const sections = [];
  if (eolProse) sections.push(eolProse);
  const opt1Body = renderTerms(option1);
  if (opt1Body) sections.push(`**Option 1 - Renew As-Is:**

${opt1Body}`);
  if (option2) {
    const headerOpt2 = hasAltUplink ? "**Option 2 - Hardware Refresh, 1G Uplink:**" : "**Option 2 - Hardware Refresh:**";
    const opt2Body = renderTerms(option2);
    if (opt2Body) sections.push(`${headerOpt2}

${opt2Body}`);
  }
  if (option3) {
    const opt3Body = renderTerms(option3);
    if (opt3Body) sections.push(`**Option 3 - Hardware Refresh, 10G Uplink:**

${opt3Body}`);
  }
  if (sections.length === 0) return null;
  const swapNoteLines = eolSwapNotes.filter((n) => n !== SME_EOL_FLAG);
  if (swapNoteLines.length > 0) sections.push(swapNoteLines.map((n) => `_${n}_`).join("\n"));
  return {
    message: sections.join("\n\n"),
    // Back-compat fields kept for the existing callsite drop-detection.
    // upgradeBlock is no longer separate — it's folded into message — so
    // the field is null and callers should rely on message alone.
    upgradeBlock: null,
    termGroups: option1,
    option1,
    option2,
    option3,
    eolDevices,
    nonEolDevices,
    mrEntQty,
    mxTier
  };
}
__name(buildDashboardRenewalQuote, "buildDashboardRenewalQuote");
async function askCFVision(prompt, imageData, env) {
  if (!env.AI) return null;
  const startMs = Date.now();
  try {
    const result = await Promise.race([
      env.AI.run(CF_MODEL, {
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${imageData.mediaType};base64,${imageData.base64}` } }
          ]
        }],
        max_tokens: 1500
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("CF_VISION_TIMEOUT")), 15e3))
    ]);
    const elapsed = Date.now() - startMs;
    const response = extractAIResponse(result);
    if (response.length < 20) return null;
    const cantSee = /(can'?t see|cannot see|don'?t see|unable to (see|view)|no image|text-based|upload)/i;
    if (cantSee.test(response)) {
      console.log(`[CF-Vision] Model can't see image (${elapsed}ms), falling back to Claude`);
      return null;
    }
    console.log(`[CF-Vision] Success (${elapsed}ms, ${response.length} chars)`);
    return { response, elapsed };
  } catch (err) {
    console.error(`[CF-Vision] Error: ${err.message} (${Date.now() - startMs}ms)`);
    return null;
  }
}
__name(askCFVision, "askCFVision");
function markdownToPlainText(md) {
  if (!md) return "";
  return md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/__([^_]+)__/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/^#{1,6}\s+/gm, "").replace(/^\s*[*+]\s+/gm, "- ").replace(/\n{3,}/g, "\n\n").trim();
}
__name(markdownToPlainText, "markdownToPlainText");
async function postWebexMessage(roomId, markdown, token) {
  const text = markdownToPlainText(markdown);
  const res = await fetch("https://webexapis.com/v1/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ roomId, markdown, text })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[WEBEX] sendMessage failed: ${res.status} ${res.statusText} \u2014 ${body.substring(0, 300)}`);
  }
  return res;
}
__name(postWebexMessage, "postWebexMessage");
async function sendMessage(roomId, markdown, token) {
  const MAX_LEN = 7e3;
  if (markdown.length <= MAX_LEN) {
    await postWebexMessage(roomId, markdown, token);
    return;
  }
  const chunks = [];
  let remaining = markdown;
  while (remaining.length > MAX_LEN) {
    let splitIdx = remaining.lastIndexOf("\n\n", MAX_LEN);
    if (splitIdx < MAX_LEN * 0.3) splitIdx = remaining.lastIndexOf("\n", MAX_LEN);
    if (splitIdx < MAX_LEN * 0.3) splitIdx = MAX_LEN;
    chunks.push(remaining.substring(0, splitIdx).trim());
    remaining = remaining.substring(splitIdx).trim();
  }
  if (remaining) chunks.push(remaining);
  for (const chunk of chunks) {
    await postWebexMessage(roomId, chunk, token);
  }
}
__name(sendMessage, "sendMessage");
function applySuffix(sku) {
  const resolved = applySuffixFamilyRules(sku);
  if (typeof resolved === "string" && resolved.endsWith("-HW")) {
    const bare = resolved.slice(0, -3);
    if (prices[bare]) return bare;
  }
  return resolved;
}
__name(applySuffix, "applySuffix");
function applySuffixFamilyRules(sku) {
  const upper = sku.toUpperCase();
  if (/^CW-(ANT|MNT|ACC|INJ|POE)/.test(upper) || upper === "CW9800H1-MCG") return upper;
  if (upper === "CW9179F") return upper;
  if (/^CW917\d/.test(upper)) {
    let cwBase = upper;
    if (/^CW917\dI?$/.test(cwBase) && !cwBase.endsWith("I")) cwBase = `${cwBase}I`;
    if (!/^CW917\d[IHD]/.test(cwBase)) return upper;
    return cwBase.endsWith("-RTG") ? cwBase : `${cwBase}-RTG`;
  }
  if (/^CW916\d/.test(upper)) {
    let cwBase = upper;
    if (/^CW916\dI?$/.test(cwBase) && !cwBase.endsWith("I")) cwBase = `${cwBase}I`;
    return cwBase.endsWith("-MR") ? cwBase : `${cwBase}-MR`;
  }
  if (/^C9(200L|300L|300X|300)-/.test(upper) && !upper.endsWith("-M") && !upper.endsWith("-A") && !upper.endsWith("-M-O")) {
    const mCandidate = `${upper}-M`;
    if (prices[mCandidate]) return mCandidate;
  }
  if (upper.startsWith("MS150") || upper.startsWith("C9") || upper.startsWith("C8") || upper.startsWith("MA-")) return upper;
  if (/^MS\d/.test(upper)) return upper.endsWith("-HW") ? upper : `${upper}-HW`;
  if (/^MX\d+C[W]?(-HW)?-NA$/i.test(upper)) return upper;
  if (/^MX\d+C(W)?$/i.test(upper)) return upper.endsWith("-HW-NA") ? upper : `${upper}-HW-NA`;
  if (/^Z\d+C?X$/i.test(upper)) return upper;
  if (/^(MR|MX|MV|MT|MG|Z)\d/.test(upper)) return upper.endsWith("-HW") ? upper : `${upper}-HW`;
  return upper;
}
__name(applySuffixFamilyRules, "applySuffixFamilyRules");
function licenseTermSiblings(sku) {
  const upper = String(sku || "").toUpperCase();
  const m = upper.match(/^(LIC-.+?)-([135])(YR?)$/);
  if (!m) return null;
  let stem = m[1];
  let yr = m[3];
  if (stem === "LIC-SME") {
    stem = SME_REPLACEMENT_BASE;
    yr = "YR";
  }
  const map = {};
  for (const [term, n] of [["1Y", "1"], ["3Y", "3"], ["5Y", "5"]]) {
    const candidate = `${stem}-${n}${yr}`;
    if (candidate in prices) map[term] = candidate;
  }
  return Object.keys(map).length ? map : null;
}
__name(licenseTermSiblings, "licenseTermSiblings");
function getLicenseSkus(baseSku, requestedTier) {
  if (requiresMsLicenseModelInputValidation(baseSku) && !hasKnownMsLicenseModelInput(baseSku)) {
    console.warn(`[LICENSE] Invalid switch model token for license generation: ${baseSku}`);
    return null;
  }
  const raw = _getLicenseSkusRaw(baseSku, requestedTier);
  if (!raw || raw.length === 0) return null;
  const validated = raw.filter((entry) => entry.sku in prices);
  if (validated.length === 0) {
    console.warn(`[LICENSE] All generated SKUs invalid for ${baseSku}: ${raw.map((e) => e.sku).join(", ")}`);
    return null;
  }
  if (validated.length < raw.length) {
    const dropped = raw.filter((e) => !(e.sku in prices)).map((e) => e.sku);
    console.warn(`[LICENSE] Dropped invalid SKUs for ${baseSku}: ${dropped.join(", ")}`);
  }
  return validated;
}
__name(getLicenseSkus, "getLicenseSkus");
function _getLicenseSkusRaw(baseSku, requestedTier) {
  const upper = baseSku.toUpperCase();
  const c8Match = upper.match(/^C(8111|8121|8455)/);
  if (c8Match) {
    const model = c8Match[1];
    const tier = requestedTier || "SEC";
    return [
      { term: "1Y", sku: `LIC-C${model}-${tier}-1Y` },
      { term: "3Y", sku: `LIC-C${model}-${tier}-3Y` },
      { term: "5Y", sku: `LIC-C${model}-${tier}-5Y` }
    ];
  }
  if (/^CW9800/.test(upper)) return null;
  if (/^MR\d/.test(upper) || /^CW9\d/.test(upper)) {
    return [
      { term: "1Y", sku: "LIC-ENT-1YR" },
      { term: "3Y", sku: "LIC-ENT-3YR" },
      { term: "5Y", sku: "LIC-ENT-5YR" }
    ];
  }
  const mxNaMatch = upper.match(/^MX(\d+C[W]?)-NA$/);
  if (mxNaMatch) {
    const model = mxNaMatch[1];
    const tier = requestedTier || "SEC";
    const numMatch = model.match(/^(\d+)/);
    const modelNum = numMatch ? parseInt(numMatch[1]) : 0;
    const isNewer = modelNum >= 75;
    const suffix = isNewer ? "Y" : "YR";
    const termSuffix = tier === "SDW" ? "Y" : suffix;
    return [
      { term: "1Y", sku: `LIC-MX${model}-${tier}-1${termSuffix}` },
      { term: "3Y", sku: `LIC-MX${model}-${tier}-3${termSuffix}` },
      { term: "5Y", sku: `LIC-MX${model}-${tier}-5${termSuffix}` }
    ];
  }
  const mxMatch = upper.match(/^MX(\d+(?:CW?|W)?)/);
  if (mxMatch) {
    const model = mxMatch[1];
    const tier = requestedTier || "SEC";
    const numMatch = model.match(/^(\d+)/);
    const modelNum = numMatch ? parseInt(numMatch[1]) : 0;
    const newerModels = [75, 85, 95, 105];
    const isNewer = newerModels.includes(modelNum);
    const suffix = isNewer ? "Y" : "YR";
    const termSuffix = tier === "SDW" ? "Y" : suffix;
    return [
      { term: "1Y", sku: `LIC-MX${model}-${tier}-1${termSuffix}` },
      { term: "3Y", sku: `LIC-MX${model}-${tier}-3${termSuffix}` },
      { term: "5Y", sku: `LIC-MX${model}-${tier}-5${termSuffix}` }
    ];
  }
  const zMatch = upper.match(/^Z(\d+)(C)?(X)?$/);
  if (zMatch) {
    const zNum = zMatch[1];
    const hasC = !!zMatch[2];
    const licModel = `Z${zNum}${hasC ? "C" : ""}`;
    if (zNum === "1" || zNum === "3") {
      return [
        { term: "1Y", sku: `LIC-${licModel}-ENT-1YR` },
        { term: "3Y", sku: `LIC-${licModel}-ENT-3YR` },
        { term: "5Y", sku: `LIC-${licModel}-ENT-5YR` }
      ];
    }
    const zTier = requestedTier === "ENT" ? "ENT" : "SEC";
    return [
      { term: "1Y", sku: `LIC-${licModel}-${zTier}-1Y` },
      { term: "3Y", sku: `LIC-${licModel}-${zTier}-3Y` },
      { term: "5Y", sku: `LIC-${licModel}-${zTier}-5Y` }
    ];
  }
  const mgMatch = upper.match(/^MG(\d+)/);
  if (mgMatch) {
    const model = mgMatch[1];
    return [
      { term: "1Y", sku: `LIC-MG${model}-ENT-1Y` },
      { term: "3Y", sku: `LIC-MG${model}-ENT-3Y` },
      { term: "5Y", sku: `LIC-MG${model}-ENT-5Y` }
    ];
  }
  if (/^MS130R-/.test(upper)) {
    const suffix = String(requestedTier || "").toUpperCase() === "A" ? "CMPTA" : "CMPT";
    return [
      { term: "1Y", sku: `LIC-MS130-${suffix}-1Y` },
      { term: "3Y", sku: `LIC-MS130-${suffix}-3Y` },
      { term: "5Y", sku: `LIC-MS130-${suffix}-5Y` }
    ];
  }
  if (/^MS130-(8|12)/.test(upper)) {
    const suffix = String(requestedTier || "").toUpperCase() === "A" ? "CMPTA" : "CMPT";
    return [
      { term: "1Y", sku: `LIC-MS130-${suffix}-1Y` },
      { term: "3Y", sku: `LIC-MS130-${suffix}-3Y` },
      { term: "5Y", sku: `LIC-MS130-${suffix}-5Y` }
    ];
  }
  const ms130Match = upper.match(/^MS130-(24|48)/);
  if (ms130Match) {
    const ports = ms130Match[1];
    const tierSuffix = String(requestedTier || "").toUpperCase() === "A" ? "A" : "";
    return [
      { term: "1Y", sku: `LIC-MS130-${ports}${tierSuffix}-1Y` },
      { term: "3Y", sku: `LIC-MS130-${ports}${tierSuffix}-3Y` },
      { term: "5Y", sku: `LIC-MS130-${ports}${tierSuffix}-5Y` }
    ];
  }
  const ms150Match = upper.match(/^MS150-(24|48)/);
  if (ms150Match) {
    const ports = ms150Match[1];
    const tierSuffix = String(requestedTier || "").toUpperCase() === "A" ? "A" : "";
    return [
      { term: "1Y", sku: `LIC-MS150-${ports}${tierSuffix}-1Y` },
      { term: "3Y", sku: `LIC-MS150-${ports}${tierSuffix}-3Y` },
      { term: "5Y", sku: `LIC-MS150-${ports}${tierSuffix}-5Y` }
    ];
  }
  const ms125Match = upper.match(/^MS125-(.+)/);
  if (ms125Match) {
    const variant = ms125Match[1];
    return [
      { term: "1Y", sku: `LIC-MS125-${variant}-1Y` },
      { term: "3Y", sku: `LIC-MS125-${variant}-3Y` },
      { term: "5Y", sku: `LIC-MS125-${variant}-5Y` }
    ];
  }
  const ms390Match = upper.match(/^MS390-(\d+)/);
  if (ms390Match) {
    const portCount = ms390Match[1];
    const tier = requestedTier === "A" ? "A" : "E";
    return [
      { term: "1Y", sku: `LIC-MS390-${portCount}${tier}-1Y` },
      { term: "3Y", sku: `LIC-MS390-${portCount}${tier}-3Y` },
      { term: "5Y", sku: `LIC-MS390-${portCount}${tier}-5Y` }
    ];
  }
  const legacyMsMatch = upper.match(/^(MS\d{3})-(.+)/);
  if (legacyMsMatch && !upper.startsWith("MS130") && !upper.startsWith("MS150")) {
    const model = legacyMsMatch[1];
    const port = legacyMsMatch[2];
    return [
      { term: "1Y", sku: `LIC-${model}-${port}-1YR` },
      { term: "3Y", sku: `LIC-${model}-${port}-3YR` },
      { term: "5Y", sku: `LIC-${model}-${port}-5YR` }
    ];
  }
  const catMatch = upper.match(/^(C9\d{3}[LX]?)-(\d+)/);
  if (catMatch) {
    let family = catMatch[1];
    let portCount = catMatch[2];
    const tier = requestedTier === "A" ? "A" : "E";
    if (family === "C9300X" || family === "C9300L") {
      family = "C9300";
    }
    if (portCount === "12") portCount = "24";
    if (family === "C9350") {
      return [
        { term: "3Y", sku: `LIC-C9350-${portCount}${tier}-3Y` },
        { term: "5Y", sku: `LIC-C9350-${portCount}${tier}-5Y` }
      ];
    }
    return [
      { term: "1Y", sku: `LIC-${family}-${portCount}${tier}-1Y` },
      { term: "3Y", sku: `LIC-${family}-${portCount}${tier}-3Y` },
      { term: "5Y", sku: `LIC-${family}-${portCount}${tier}-5Y` }
    ];
  }
  const mvMatch = upper.match(/^MV(\d+)/);
  if (mvMatch) {
    return [
      { term: "1Y", sku: "LIC-MV-1YR" },
      { term: "3Y", sku: "LIC-MV-3YR" },
      { term: "5Y", sku: "LIC-MV-5YR" }
    ];
  }
  const mtMatch = upper.match(/^MT(\d+)/);
  if (mtMatch) {
    return [
      { term: "1Y", sku: "LIC-MT-1Y" },
      { term: "3Y", sku: "LIC-MT-3Y" },
      { term: "5Y", sku: "LIC-MT-5Y" }
    ];
  }
  return null;
}
__name(_getLicenseSkusRaw, "_getLicenseSkusRaw");
function buildStratusUrl(items) {
  items = applyEolSwaps(items).lines.filter((l) => l.valid !== false);
  const merged = /* @__PURE__ */ new Map();
  for (const { sku, qty } of items) {
    merged.set(sku, (merged.get(sku) || 0) + qty);
  }
  const orderedSkus = [...merged.keys()];
  const qtys = orderedSkus.map((s) => merged.get(s));
  return `https://stratusinfosystems.com/order/?item=${orderedSkus.join(",")}&qty=${qtys.join(",")}`;
}
__name(buildStratusUrl, "buildStratusUrl");
function _extractVariant(upper, family) {
  const raw = upper.slice(family.length);
  return raw.startsWith("-") ? raw.slice(1) : raw;
}
__name(_extractVariant, "_extractVariant");
function checkEol(baseSku) {
  const upper = baseSku.toUpperCase();
  if (EOL_REPLACEMENTS[upper]) return EOL_REPLACEMENTS[upper];
  for (const [family, variants] of Object.entries(EOL_PRODUCTS)) {
    if (upper.startsWith(family)) {
      const variant = _extractVariant(upper, family);
      if (variants.includes(variant)) {
        return EOL_REPLACEMENTS[upper] || EOL_REPLACEMENTS[family] || null;
      }
    }
  }
  return null;
}
__name(checkEol, "checkEol");
function isEol(baseSku) {
  const upper = baseSku.toUpperCase();
  for (const [family, variants] of Object.entries(EOL_PRODUCTS)) {
    if (upper.startsWith(family)) {
      const variant = _extractVariant(upper, family);
      if (variants.includes(variant)) return true;
    }
  }
  return false;
}
__name(isEol, "isEol");
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}
__name(levenshtein, "levenshtein");
function fuzzyMatchInFamily(input, family) {
  const upper = input.toUpperCase();
  const variants = catalog[family];
  if (!variants || !Array.isArray(variants)) return [];
  const candidates = variants.map((v) => {
    const fullSku = family.match(/^(MR|MX|MV|MT|MG|Z|CW)$/) ? v : v;
    return { sku: fullSku, distance: levenshtein(upper, fullSku.toUpperCase()) };
  });
  return candidates.filter((c) => c.distance <= 3 && c.distance > 0).sort((a, b) => a.distance - b.distance).slice(0, 5);
}
__name(fuzzyMatchInFamily, "fuzzyMatchInFamily");
function fuzzyMatchAllFamilies(input) {
  const upper = input.toUpperCase();
  const results = [];
  for (const [family, variants] of Object.entries(catalog)) {
    if (family.startsWith("_") || !Array.isArray(variants)) continue;
    for (const sku of variants) {
      const dist = levenshtein(upper, sku.toUpperCase());
      if (dist <= 2) results.push({ sku, distance: dist });
    }
  }
  return results.sort((a, b) => a.distance - b.distance).slice(0, 5);
}
__name(fuzzyMatchAllFamilies, "fuzzyMatchAllFamilies");
function fixCommonMistake(sku) {
  const upper = sku.toUpperCase();
  const mistake = COMMON_MISTAKES[upper];
  if (mistake && mistake.suggest && mistake.suggest.length > 0) {
    return { error: mistake.error, suggest: mistake.suggest };
  }
  if (!VALID_SKUS.has(upper) && !isEol(upper)) {
    for (const [key, val] of Object.entries(COMMON_MISTAKES)) {
      if (upper.startsWith(key + "-") && val.suggest && val.suggest.length > 0) {
        const suffix = upper.slice(key.length).toUpperCase();
        const appended = val.suggest.map((s) => s + suffix).filter((s) => VALID_SKUS.has(s.toUpperCase()) || isEol(s));
        if (appended.length > 0) {
          return { error: val.error, suggest: appended };
        }
        const filtered = val.suggest.filter((s) => s.toUpperCase().endsWith(suffix));
        if (filtered.length > 0) {
          return { error: val.error, suggest: filtered };
        }
        return { error: val.error, suggest: val.suggest };
      }
    }
  }
  return null;
}
__name(fixCommonMistake, "fixCommonMistake");
function validateSku(baseSku) {
  const upper = baseSku.toUpperCase();
  const mistake = fixCommonMistake(upper);
  if (mistake) return { valid: false, reason: mistake.error, suggest: mistake.suggest, isCommonMistake: true };
  if (VALID_SKUS.has(upper)) {
    const eol = isEol(upper);
    return eol ? { valid: true, eol: true } : { valid: true };
  }
  if (isEol(upper)) return { valid: true, eol: true };
  const noHw = upper.replace(/-HW(-NA)?$/, "");
  if (noHw !== upper && (VALID_SKUS.has(noHw) || isEol(noHw))) {
    return isEol(noHw) ? { valid: true, eol: true } : { valid: true };
  }
  if (/^MA-/.test(upper)) return { valid: true };
  const family = detectFamily(upper);
  if (family && catalog[family]) {
    const partialMatches = catalog[family].filter((s) => s.toUpperCase().includes(upper) || upper.includes(s.toUpperCase()));
    if (partialMatches.length > 0) {
      return { valid: false, reason: `${upper} is not a recognized model`, suggest: partialMatches, isPartialMatch: partialMatches.length > 1 };
    }
    const fuzzyMatches = fuzzyMatchInFamily(upper, family);
    if (fuzzyMatches.length > 0) {
      const suggestions2 = fuzzyMatches.map((m) => m.sku);
      const closest = fuzzyMatches[0];
      return {
        valid: false,
        reason: `${upper} is not a recognized model`,
        suggest: suggestions2,
        isFuzzyMatch: true,
        closestDistance: closest.distance
      };
    }
    const suggestions = catalog[family].slice(0, 5);
    return { valid: false, reason: `${upper} is not a recognized model`, suggest: suggestions, isPartialMatch: false };
  }
  const crossFamilyMatches = fuzzyMatchAllFamilies(upper);
  if (crossFamilyMatches.length > 0) {
    return {
      valid: false,
      reason: `${upper} is not a recognized SKU`,
      suggest: crossFamilyMatches.map((m) => m.sku),
      isFuzzyMatch: true,
      closestDistance: crossFamilyMatches[0].distance
    };
  }
  return { valid: false, reason: `${upper} is not a recognized SKU` };
}
__name(validateSku, "validateSku");
function detectFamily(sku) {
  if (/^MR\d/.test(sku)) return "MR";
  if (/^MX\d/.test(sku)) return "MX";
  if (/^MV\d/.test(sku)) return "MV";
  if (/^MT\d/.test(sku)) return "MT";
  if (/^MG\d/.test(sku)) return "MG";
  if (/^Z\d/.test(sku)) return "Z";
  if (/^MS130/.test(sku)) return "MS130";
  if (/^MS150/.test(sku)) return "MS150";
  if (/^MS120/.test(sku)) return "MS120";
  if (/^MS125/.test(sku)) return "MS125";
  if (/^MS210/.test(sku)) return "MS210";
  if (/^MS220/.test(sku)) return "MS220";
  if (/^MS225/.test(sku)) return "MS225";
  if (/^MS250/.test(sku)) return "MS250";
  if (/^MS320/.test(sku)) return "MS320";
  if (/^MS350/.test(sku)) return "MS350";
  if (/^MS355/.test(sku)) return "MS355";
  if (/^MS390/.test(sku)) return "MS390";
  if (/^MS410/.test(sku)) return "MS410";
  if (/^MS420/.test(sku)) return "MS420";
  if (/^MS425/.test(sku)) return "MS425";
  if (/^MS450/.test(sku)) return "MS450";
  if (/^CW9/.test(sku)) return "CW";
  if (/^C9300X/.test(sku)) return "C9300X";
  if (/^C9300L/.test(sku)) return "C9300L";
  if (/^C9300/.test(sku)) return "C9300";
  if (/^C9200L/.test(sku)) return "C9200L";
  if (/^C8111/.test(sku)) return "C8111";
  if (/^C8121/.test(sku)) return "C8121";
  if (/^C8455/.test(sku)) return "C8455";
  return null;
}
__name(detectFamily, "detectFamily");
function dashInsensitiveCatalogKey(upper) {
  const bare = upper.replace(/[-=]/g, "");
  let hit = null;
  for (const k of Object.keys(prices)) {
    if (k.toUpperCase().replace(/[-=]/g, "") === bare) {
      if (hit) return null;
      hit = k;
    }
  }
  return hit;
}
__name(dashInsensitiveCatalogKey, "dashInsensitiveCatalogKey");
function getPrice(sku) {
  const upper = sku.toUpperCase();
  if (prices[upper]) return prices[upper];
  const noHw = upper.replace(/-HW(-NA)?$/, "");
  if (noHw !== upper && prices[noHw]) return prices[noHw];
  if (prices[`${upper}-HW`]) return prices[`${upper}-HW`];
  if (prices[`${upper}-MR`]) return prices[`${upper}-MR`];
  if (prices[`${upper}-RTG`]) return prices[`${upper}-RTG`];
  const suffixed = applySuffix(upper);
  if (suffixed !== upper && prices[suffixed]) return prices[suffixed];
  const dashed = dashInsensitiveCatalogKey(upper);
  if (dashed) return prices[dashed];
  return null;
}
__name(getPrice, "getPrice");
function parseStratusUrl(url) {
  try {
    const u = new URL(url);
    const items = (u.searchParams.get("item") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const qtyStr = (u.searchParams.get("qty") || "").split(",").map((s) => parseInt(s.trim())).filter((n) => !isNaN(n));
    if (items.length === 0) return null;
    const qtys = qtyStr.length === items.length ? qtyStr : items.map(() => 1);
    const swapped = applyEolSwaps(items.map((s, i) => ({ sku: s, qty: qtys[i] }))).lines;
    if (swapped.length === 0) return null;
    return { skus: swapped.map((l) => l.sku), qtys: swapped.map((l) => Number(l.qty) || 1) };
  } catch {
    return null;
  }
}
__name(parseStratusUrl, "parseStratusUrl");
function calculatePricing(skus, qtys) {
  const lines = [];
  let cartTotal = 0;
  const missing = [];
  let found = 0;
  for (let i = 0; i < skus.length; i++) {
    const sku = skus[i];
    const qty = qtys[i] || 1;
    const p = getPrice(sku);
    if (p) {
      found++;
      const lineTotal = p.price * qty;
      cartTotal += lineTotal;
      if (qty > 1) {
        lines.push(`\u2022 ${qty} \xD7 ${sku} - $${p.price.toLocaleString("en-US", { minimumFractionDigits: 2 })} each ($${lineTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })})`);
      } else {
        lines.push(`\u2022 ${sku} - $${p.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
      }
    } else {
      missing.push(sku);
    }
  }
  return { lines, cartTotal, found, missing };
}
__name(calculatePricing, "calculatePricing");
function formatPricingResponse(label, skus, qtys) {
  const { lines, cartTotal, found, missing } = calculatePricing(skus, qtys);
  if (found === 0) return null;
  const parts = [];
  if (label) parts.push(`**${label}**`);
  const url = buildStratusUrl(skus.map((s, i) => ({ sku: s, qty: qtys[i] })));
  parts.push(url);
  parts.push("");
  parts.push(...lines);
  parts.push(`**Cart Total: $${cartTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}**`);
  if (missing.length > 0) {
    parts.push(`
_Pricing unavailable for: ${missing.join(", ")}_`);
  }
  return parts.join("\n");
}
__name(formatPricingResponse, "formatPricingResponse");
function handleEolDateRequest(text) {
  const upper = text.toUpperCase();
  const eolIntent = /\b(END OF (SUPPORT|SALE|LIFE)|EOL|EOS|EOST|WHEN (DOES|DID|IS|WAS|WILL) .+ (EOL|END|EXPIRE|SUNSET|DISCONTINUED)|LIFECYCLE|LAST DAY OF SUPPORT)\b/i.test(text);
  if (!eolIntent) return null;
  const skuPattern = /\b((?:MR|MX|MV|MG|MS|MT|CW|Z)\d[\w-]*)\b/gi;
  const matches = [...upper.matchAll(skuPattern)].map((m) => m[1]);
  const skus = [...new Set(matches)];
  if (skus.length === 0) return null;
  const lines = [];
  for (const sku of skus) {
    const skuUpper = sku.toUpperCase();
    let isEolProduct = false;
    let fullSkuKey = skuUpper;
    if (EOL_DATES[skuUpper]) {
      isEolProduct = true;
    } else {
      for (const [family, variants] of Object.entries(EOL_PRODUCTS)) {
        if (skuUpper.startsWith(family)) {
          const raw = skuUpper.slice(family.length);
          const variant = raw.startsWith("-") ? raw.slice(1) : raw;
          if (variants.includes(variant)) {
            isEolProduct = true;
            fullSkuKey = skuUpper;
            break;
          }
        }
      }
    }
    if (!isEolProduct) {
      lines.push(`**${skuUpper}** \u2014 \u2705 Active product (not end-of-life)`);
      continue;
    }
    const dates = EOL_DATES[fullSkuKey];
    const replacement = EOL_REPLACEMENTS[fullSkuKey];
    let line = `**${skuUpper}**`;
    if (dates) {
      const eosDate = new Date(dates.eos);
      const eostDate = new Date(dates.eost);
      const now = /* @__PURE__ */ new Date();
      const eosLabel = eosDate <= now ? "End of Sale (passed)" : "End of Sale";
      const eostLabel = eostDate <= now ? "End of Support (passed)" : "End of Support";
      line += `
  \u{1F4C5} ${eosLabel}: **${dates.eos}**`;
      line += `
  \u{1F6E1}\uFE0F ${eostLabel}: **${dates.eost}**`;
      const daysToEost = Math.round((eostDate - now) / (1e3 * 60 * 60 * 24));
      if (daysToEost > 0) {
        line += ` _(${daysToEost} days remaining)_`;
      } else {
        line += ` _(${Math.abs(daysToEost)} days ago)_`;
      }
    } else {
      line += "\n  \u{1F4C5} EOL confirmed (exact dates not available)";
    }
    if (replacement) {
      if (Array.isArray(replacement)) {
        line += `
  \u{1F504} Replacement: **${replacement[0]}** (1G) or **${replacement[1]}** (10G)`;
      } else {
        line += `
  \u{1F504} Replacement: **${replacement}**`;
      }
    }
    lines.push(line);
  }
  if (lines.length === 0) return null;
  const header = skus.length === 1 ? "**End-of-Life Status**" : `**End-of-Life Status (${skus.length} products)**`;
  return `${header}

${lines.join("\n\n")}`;
}
__name(handleEolDateRequest, "handleEolDateRequest");
async function handleQuoteConfirmation(text, personId, kv) {
  const confirmIntent = /^\s*(yes|yeah|yep|yea|sure|please|go ahead|do it|quote it|generate (a |the )?quote|yes.*quote|please.*quote|let'?s do it|go for it)\s*[.!]?\s*$/i.test(text);
  if (!confirmIntent) return null;
  if (!personId || !kv) return null;
  const history = await getHistory(kv, personId);
  if (history.length === 0) return null;
  const assistantMsgs = history.filter((h) => h.role === "assistant").reverse();
  if (assistantMsgs.length === 0) return null;
  const lastAssistant = assistantMsgs[0].content;
  if (lastAssistant.includes("stratusinfosystems.com/order/")) return null;
  if (/datasheet|check for updates/i.test(lastAssistant)) return null;
  if (!/quote|would you like|pricing/i.test(lastAssistant)) return null;
  const skuPattern = /\b((?:MR|MX|MV|MG|MS|MT|CW|Z|C9)\d[\w-]*(?:-M)?)\b/gi;
  const matches = [...lastAssistant.matchAll(skuPattern)];
  if (matches.length === 0) return null;
  const allSkus = [...new Set(matches.map((m) => m[1].toUpperCase()))];
  const hwSkus = allSkus.filter((s) => !s.startsWith("LIC-") && !s.startsWith("LIC"));
  if (hwSkus.length === 0) return null;
  const syntheticRequest = `quote ${hwSkus.map((s) => `1 ${s}`).join(", ")}`;
  const parsed = parseMessage(syntheticRequest);
  if (parsed && parsed.items && parsed.items.length > 0) {
    const result = buildQuoteResponse(parsed);
    if (!result.needsLlm && result.message) {
      return result.message;
    }
  }
  return null;
}
__name(handleQuoteConfirmation, "handleQuoteConfirmation");
async function handleFollowUpModifier(text, personId, kv) {
  if (!personId || !kv) return null;
  const upper = text.toUpperCase().trim();
  const hasAddPrefix = /^(ADD|ALSO\s+(?:ADD|INCLUDE))\b/i.test(upper);
  const hasRemovePrefix = /^(REMOVE|TAKE\s+OUT|WITHOUT)\b/i.test(upper);
  const hasSwapPrefix = /^(CHANGE|SWAP|REPLACE|SWITCH)\b/i.test(upper);
  const isHwOnly = /^(?:PLEASE\s+|CAN\s+YOU\s+|COULD\s+YOU\s+)?(HARDWARE\s+ONLY|HW\s+ONLY|JUST\s+(THE\s+)?HARDWARE|NO\s+LICENSE[S]?|WITHOUT\s+LICENSE[S]?|(?:REMOVE|DROP|TAKE)\s+(?:OUT\s+|OFF\s+)?(?:THE\s+|ALL\s+)?LICEN[SC]E[S]?(?:\s+(?:OUT|OFF))?(?:\s+(?:FROM|OF)\s+(?:THE\s+|THAT\s+|THIS\s+)?(?:QUOTE|CART|ORDER))?)(?:\s+PLEASE)?\s*[.!?]?\s*$/i.test(upper);
  const isLicOnly = /^(LICENSE[S]?\s+ONLY|LICENCE[S]?\s+ONLY|JUST\s+(THE\s+)?LICENSE[S]?|LICENSE[S]?\s+RENEWAL|RENEWAL\s+ONLY|NO\s+HARDWARE)\s*\.?\s*$/i.test(upper);
  const isTermOnly = upper.match(/^(?:(?:CHANGE|SWAP|REPLACE|SWITCH|MAKE|GO)(?:\s+(?:TO|WITH\s+THE|WITH|IT\s+TO|IT|THAT|TERM\s+TO))?\s+)?(?:JUST\s+(?:THE\s+)?|ONLY\s+(?:THE\s+)?)?(?:A\s+)?([135])\s*-?\s*(?:YEAR|YR)S?(?:\s+(?:ONLY|PLEASE|LICENSE[S]?|TERM))?\s*\.?\s*$/i);
  const isAddPricing = /^(ADD\s+PRICING|WITH\s+PRICING|INCLUDE\s+PRICING|SHOW\s+ME\s+PRICING|HOW\s+MUCH(\s+(IS|ARE)\s+(IT|THAT|THOSE|THIS|THESE|THEM))?\s*\??\s*)$/i.test(upper);
  const isQtyChange = /^(?:(?:CHANGE|UPDATE|SET)\s+(?:THE\s+)?(?:QTY|QUANTITY)(?:\s+TO)?\s+\d+|MAKE\s+(?:IT|THAT|THEM)\s+\d+|ACTUALLY\s+\d+|\d+\s+(?:INSTEAD|LICENSES\s+INSTEAD|USERS\s+INSTEAD|SEATS\s+INSTEAD)|(?:BUMP|INCREASE|RAISE)(?:\s+IT)?(?:\s+UP)?\s+TO\s+\d+|(?:LOWER|DROP|REDUCE)(?:\s+IT)?(?:\s+DOWN)?\s+TO\s+\d+|QTY\s*:?\s*\d+|DOUBLE\s+(?:IT|THAT)|(?:CHANGE|SWITCH)\s+TO\s+\d+(?:\s+(?:USERS|SEATS|LICENSES))?)\s*\.?\s*$/i.test(upper);
  const isUmbTypeSwap = /^(?:UMBRELLA\s+)?(?:DNS|SIG|SECURE\s+INTERNET\s+GATEWAY)(?:\s+(?:ESSENTIALS?|ADVANTAGE))?\s+INSTEAD\s*\.?\s*$/i.test(upper);
  const isAllTerms = /^(?:PLEASE\s+)?(?:CAN\s+YOU\s+|COULD\s+YOU\s+)?(?:PROVIDE|SHOW|GIVE|LIST|DISPLAY|SEND|QUOTE|WHAT\s+ARE)?\s*(?:ME\s+)?(?:THE\s+)?(?:(?:ALL\s+)?1\s*(?:-|–|TO|THROUGH)\s*5\s*-?\s*(?:YEAR|YR)S?|1\s*,?\s*3\s*,?\s*(?:AND\s+|&\s*)?5\s*-?\s*(?:YEAR|YR)S?|ALL\s+(?:THE\s+)?(?:TERM|YEAR)S?|(?:THE\s+)?OTHER\s+TERMS?)\s*(?:TERM\s+)?(?:OPTIONS?)?\s*\.?\s*\??\s*$/i.test(upper);
  let compound = null;
  if (!isHwOnly && !isLicOnly && !isTermOnly && !isAddPricing && !isQtyChange && !isUmbTypeSwap && !isAllTerms && !hasAddPrefix && !hasRemovePrefix && !hasSwapPrefix) {
    compound = (() => {
      if (!/\b(COSTS?|PRICES?|PRICING|HOW\s+MUCH|TOTALS?)\b/i.test(upper)) return null;
      if (/LIC-|\b(?:MR|MS|MX|MV|MT|MG|CW|C9|C8|Z)\d/i.test(upper)) return null;
      let rest = upper.replace(/['’]S\b/g, "").replace(/[?.!,;:]/g, " ");
      rest = rest.replace(/\b(COSTS?|PRICES?|PRICING|HOW\s+MUCH|TOTALS?)\b/g, " ");
      const mutations = [];
      const typeM = rest.match(/\b(DNS|SIG|SECURE\s+INTERNET\s+GATEWAY)(?:\s+(ESSENTIALS?|ADVANTAGE))?\b/);
      if (typeM) {
        mutations.push(`CHANGE TO ${/^SECURE/.test(typeM[1]) ? "SIG" : typeM[1]}${typeM[2] ? " " + typeM[2] : ""}`);
        rest = rest.replace(typeM[0], " ");
      }
      const tierM = rest.match(/\b(ESSENTIALS?|ADVANTAGE|PREMIER)\b/);
      if (tierM) {
        mutations.push(`CHANGE TO ${tierM[1]}`);
        rest = rest.replace(tierM[0], " ");
      }
      let termMutation = null;
      const termM = rest.match(/(?<![\w-])([135])\s*-?\s*(?:YEAR|YR)S?(?:\s+TERM)?\b/);
      if (termM) {
        termMutation = [null, termM[1]];
        mutations.push(termMutation);
        rest = rest.replace(termM[0], " ");
      }
      if (mutations.length > 1) return null;
      if (/\d/.test(rest)) return null;
      rest = rest.replace(/\b(WHAT|WHATS|ARE|IS|WAS|WILL|WOULD|BE|DO|DOES|THE|THIS|THAT|THOSE|THESE|IT|THEM|A|AN|FOR|OF|ON|AT|TO|IN|WITH|AND|ME|MY|OUR|US|PLEASE|THANKS|THANK|YOU|CAN|COULD|SHOW|GIVE|TELL|JUST|NOW|OPTION|OPTIONS|ONE|ONES|TIER|VERSION|PACKAGE|LICENSE|LICENSES|LICENCE|LICENCES|QUOTE|CART|ORDER|MUCH|HOW|ALL|EVERYTHING|WHOLE)\b/g, " ");
      if (rest.trim().length > 0) return null;
      return {
        mutationText: typeof mutations[0] === "string" ? mutations[0] : null,
        // tier/type swap → applyItemMutation
        termM: termMutation
        // term → shared term filter
      };
    })();
    if (!compound) return null;
  }
  const history = await getHistory(kv, personId);
  if (!history || history.length === 0) return null;
  const assistantMsgs = history.filter((h) => h.role === "assistant").reverse();
  if (assistantMsgs[0] && /Which (?:Cisco Duo tier|Umbrella package) do you need\? \(qty:/i.test(assistantMsgs[0].content)) return null;
  let lastUrl = null, lastTermLabels = [];
  for (const m of assistantMsgs) {
    const urlRegex = /(?:\*\*)?(\d)-Year\s+Co-Term(?:\*\*)?\s*:?\s*(?:\*\*)?\s*(https:\/\/stratusinfosystems\.com\/order\/\?item=[^\s)*]+)/gi;
    const urlMatches = [...m.content.matchAll(urlRegex)];
    if (urlMatches.length > 0) {
      lastTermLabels = urlMatches.map((u) => ({ term: parseInt(u[1], 10), url: u[2] }));
      lastUrl = lastTermLabels[0].url;
      break;
    }
    const anyUrl = m.content.match(/(https:\/\/stratusinfosystems\.com\/order\/\?item=[^\s)*]+)/);
    if (anyUrl) {
      lastUrl = anyUrl[1];
      lastTermLabels = [{ term: null, url: anyUrl[1] }];
      break;
    }
  }
  if (!lastUrl) return null;
  const urlToItems = /* @__PURE__ */ __name((url) => {
    try {
      const m = url.match(/[?&]item=([^&]+)&qty=([^&\s)]+)/);
      if (!m) return null;
      const skus = m[1].split(",").map((s) => decodeURIComponent(s.trim()));
      const qtys = m[2].split(",").map((q) => parseInt(decodeURIComponent(q.trim()), 10));
      if (skus.length !== qtys.length) return null;
      if (skus.some((s) => !s) || qtys.some((q) => !Number.isFinite(q) || q <= 0)) return null;
      return skus.map((sku, i) => {
        const sm = String(sku).match(/^LIC-SME-([135])Y(R?)$/i);
        if (sm) smeIngestSubstituted = true;
        return { sku: sm ? smeReplacementSku(sm[1]) : sku, qty: qtys[i] };
      });
    } catch {
      return null;
    }
  }, "urlToItems");
  let smeIngestSubstituted = false;
  const termItems = {};
  for (const entry of lastTermLabels) {
    const items = urlToItems(entry.url);
    if (items) termItems[entry.term || "na"] = items;
  }
  if (Object.keys(termItems).length === 0) return null;
  const applyHwOnly = /* @__PURE__ */ __name((items) => items.filter((i) => !/^LIC-/i.test(i.sku)), "applyHwOnly");
  const applyLicOnly = /* @__PURE__ */ __name((items, term) => {
    const licOnly = items.filter((i) => /^LIC-/i.test(i.sku));
    if (licOnly.length > 0) return licOnly;
    const generated = [];
    for (const { sku, qty } of items) {
      const cleanBase = sku.replace(/-(HW|MR|RTG|HW-NA)$/i, "");
      const lics = getLicenseSkus(cleanBase, null);
      if (lics) {
        const found = lics.find((l) => l.term === `${term || 3}Y`);
        if (found) generated.push({ sku: found.sku, qty });
      }
    }
    return generated;
  }, "applyLicOnly");
  const applyItemMutation = /* @__PURE__ */ __name((items, freshText, bucketTerm) => {
    const up = freshText.toUpperCase();
    const tierSwapM = up.match(/^(?:CHANGE|SWAP|REPLACE|SWITCH)(?:\s+(?:IT|THEM|THAT|THESE|THOSE))?(?:\s+(?:TO|WITH|FOR))?\s+(?:(DUO|UMBRELLA)\s+)?(ESSENTIALS?|ADVANTAGE|PREMIER)\s*\.?\s*$/i);
    if (tierSwapM) {
      const wantFamily = tierSwapM[1] ? tierSwapM[1].toUpperCase() : null;
      const want = /^ESSENTIAL/i.test(tierSwapM[2]) ? "ESSENTIALS" : tierSwapM[2].toUpperCase();
      let anySwappable = false, anyFailed = false;
      const swapped = items.map((i) => {
        const duoM = String(i.sku).match(/^LIC-DUO-(ESSENTIALS|ADVANTAGE|PREMIER)(-.+)$/i);
        if (duoM) {
          if (wantFamily === "UMBRELLA") return i;
          anySwappable = true;
          const newSku = ("LIC-DUO-" + want + duoM[2]).toUpperCase();
          if (newSku in prices) return { ...i, sku: newSku };
          anyFailed = true;
          return i;
        }
        const umbM = String(i.sku).match(/^LIC-UMB-(DNS|SIG)-(ESS|ADV)(-K9-.+)$/i);
        if (umbM) {
          if (wantFamily === "DUO") return i;
          anySwappable = true;
          const wantUmb = want === "ESSENTIALS" ? "ESS" : want === "ADVANTAGE" ? "ADV" : null;
          if (!wantUmb) {
            anyFailed = true;
            return i;
          }
          const newSku = ("LIC-UMB-" + umbM[1] + "-" + wantUmb + umbM[3]).toUpperCase();
          if (newSku in prices) return { ...i, sku: newSku };
          anyFailed = true;
          return i;
        }
        return i;
      });
      if (!anySwappable || anyFailed) return null;
      return swapped;
    }
    const umbTypeSwapM = up.match(/^(?:CHANGE|SWAP|REPLACE|SWITCH)(?:\s+(?:IT|THEM|THAT|THESE|THOSE))?(?:\s+(?:TO|WITH|FOR))?\s+(?:UMBRELLA\s+)?(DNS|SIG|SECURE\s+INTERNET\s+GATEWAY)(?:\s+(ESSENTIALS?|ADVANTAGE))?\s*\.?\s*$/i) || up.match(/^(?:UMBRELLA\s+)?(DNS|SIG|SECURE\s+INTERNET\s+GATEWAY)(?:\s+(ESSENTIALS?|ADVANTAGE))?\s+INSTEAD\s*\.?\s*$/i);
    if (umbTypeSwapM) {
      const wantType = /^SECURE/i.test(umbTypeSwapM[1]) ? "SIG" : umbTypeSwapM[1].toUpperCase();
      const wantTier = umbTypeSwapM[2] ? /^ESSENTIAL/i.test(umbTypeSwapM[2]) ? "ESS" : "ADV" : null;
      let anyUmbrella = false, anyFailed = false;
      const swapped = items.map((i) => {
        const umbM = String(i.sku).match(/^LIC-UMB-(DNS|SIG)-(ESS|ADV)(-K9-.+)$/i);
        if (!umbM) return i;
        anyUmbrella = true;
        const newSku = ("LIC-UMB-" + wantType + "-" + (wantTier || umbM[2].toUpperCase()) + umbM[3]).toUpperCase();
        if (newSku in prices) return { ...i, sku: newSku };
        anyFailed = true;
        return i;
      });
      if (!anyUmbrella || anyFailed) return null;
      const changedUmb = swapped.some((s, idx) => s.sku !== items[idx].sku);
      if (!changedUmb) return null;
      return swapped;
    }
    const qtyDouble = /^DOUBLE\s+(?:IT|THAT)\s*\.?\s*$/i.test(up);
    const qtyNumM = !qtyDouble && isQtyChange ? up.match(/\b(\d+)\b/) : null;
    if (qtyDouble || qtyNumM) {
      const uniform = items.length > 0 && items.every((i) => i.qty === items[0].qty);
      if (!uniform) return null;
      let n;
      if (qtyDouble) n = items[0].qty * 2;
      else {
        n = parseInt(qtyNumM[1], 10);
        if ([1, 3, 5].includes(n) && !/\b(QTY|QUANTITY|USERS|SEATS|LICENSES|INSTEAD)\b/i.test(up)) return null;
      }
      if (!Number.isFinite(n) || n <= 0 || n > 1e5) return null;
      if (n === items[0].qty) return null;
      return items.map((i) => ({ ...i, qty: n }));
    }
    const removeMatch = up.match(/^(?:REMOVE|TAKE\s+OUT|WITHOUT|DROP)\s+(\d+\s+)?(?:THE\s+|THESE\s+|THOSE\s+|MY\s+)?([A-Z0-9][-A-Z0-9]+)/i);
    if (removeMatch) {
      if (removeMatch[1]) return null;
      const rmSku = removeMatch[2].toUpperCase();
      if (/^\d+$/.test(rmSku)) return null;
      const next = items.filter((i) => i.sku.toUpperCase() !== rmSku && i.sku.toUpperCase() !== applySuffix(rmSku).toUpperCase());
      if (next.length === items.length) return null;
      const removedWasHardware = items.some((i) => !/^LIC-/i.test(i.sku) && !next.includes(i));
      if (removedWasHardware && next.some((i) => /^LIC-/i.test(i.sku))) return null;
      return next;
    }
    const addMatch = freshText.match(/^(?:ADD|ALSO\s+(?:ADD|INCLUDE))\s+(.+)$/i);
    if (addMatch) {
      const addText = addMatch[1].replace(/\b(more|additional|extra)\b/gi, " ");
      let parsed = null;
      try {
        parsed = parseMessage(addText);
      } catch {
        parsed = null;
      }
      if (parsed && parsed.items && parsed.items.length > 0 && !parsed.isClarification) {
        const merged = items.map((i) => ({ ...i }));
        let changed = false;
        const pMods = parsed.modifiers || {};
        for (const it of parsed.items) {
          const hwSku = applySuffix(it.baseSku);
          const tm = String(hwSku).match(/-([135])(?:YR|Y-S\d+|Y)$/i);
          if (tm && bucketTerm == null) return null;
          if (tm && String(tm[1]) !== String(bucketTerm)) continue;
          const itHwOnly = (it.hardwareOnly ?? pMods.hardwareOnly) === true;
          const itLicOnly = (it.licenseOnly ?? pMods.licenseOnly) === true;
          if (!itLicOnly) {
            const existingIdx = merged.findIndex((e) => e.sku.toUpperCase() === hwSku.toUpperCase());
            if (existingIdx >= 0) merged[existingIdx].qty += it.qty;
            else merged.push({ sku: hwSku, qty: it.qty });
            changed = true;
          }
          if (!itHwOnly && bucketTerm != null && !/^LIC-/i.test(hwSku)) {
            let lics = null;
            try {
              lics = getLicenseSkus(it.baseSku);
            } catch {
              lics = null;
            }
            const lic = Array.isArray(lics) ? lics.find((l) => l && l.term === `${bucketTerm}Y`) : null;
            if (lic && lic.sku && lic.sku in prices) {
              const li = merged.findIndex((e) => e.sku.toUpperCase() === String(lic.sku).toUpperCase());
              if (li >= 0) merged[li].qty += it.qty;
              else merged.push({ sku: lic.sku, qty: it.qty });
              changed = true;
            } else if (itLicOnly) {
              return null;
            }
          }
        }
        if (!changed) return null;
        return merged;
      }
    }
    return null;
  }, "applyItemMutation");
  let filteredTerms = Object.entries(termItems);
  let smeReplacedApplied = false;
  const termFilterM = isTermOnly || compound && compound.termM || null;
  if (termFilterM) {
    const wantTerm = parseInt(termFilterM[1], 10);
    const single = filteredTerms.find(([k]) => String(k) === String(wantTerm));
    if (single) {
      filteredTerms = [single];
    } else {
      const rewrittenItems = [];
      let anyTermBearing = false;
      let anyFailed = false;
      for (const [, items] of filteredTerms) {
        for (let it of items) {
          const tm = String(it.sku).match(/-([135])(YR|Y-S\d+|Y)$/i);
          if (!tm) {
            rewrittenItems.push(it);
            continue;
          }
          anyTermBearing = true;
          const currentTerm = parseInt(tm[1], 10);
          if (/^LIC-SME/i.test(String(it.sku))) {
            it = { sku: smeReplacementSku(currentTerm), qty: it.qty };
            smeReplacedApplied = true;
          }
          if (currentTerm === wantTerm) {
            rewrittenItems.push(it);
            continue;
          }
          const newSku = rewriteSkuTerm(it.sku, wantTerm);
          if (newSku && newSku !== it.sku && newSku in prices) {
            rewrittenItems.push({ sku: newSku, qty: it.qty });
          } else {
            anyFailed = true;
          }
        }
      }
      if (anyTermBearing && anyFailed) return null;
      if (anyTermBearing && rewrittenItems.length > 0) {
        const _seen = /* @__PURE__ */ new Map();
        for (const it of rewrittenItems) {
          const k = String(it.sku).toUpperCase();
          if (!_seen.has(k) || _seen.get(k).qty < it.qty) _seen.set(k, it);
        }
        const _deduped = [..._seen.values()];
        filteredTerms = [[String(wantTerm), _deduped]];
      }
    }
  }
  if (isAllTerms) {
    const srcItems = filteredTerms.length > 0 ? filteredTerms[0][1] : null;
    if (!srcItems || srcItems.length === 0) return null;
    const TERM_SUFFIX_RE = /-([135])(YR|Y-S\d+|Y)$/i;
    const termBearing = srcItems.filter((it) => TERM_SUFFIX_RE.test(String(it.sku)));
    if (termBearing.length === 0) return null;
    const targetTerms = [1, 3, 5];
    const buckets = [];
    for (const t of targetTerms) {
      const bucket = [];
      for (let it of srcItems) {
        const tm = String(it.sku).match(TERM_SUFFIX_RE);
        if (!tm) {
          bucket.push(it);
          continue;
        }
        if (/^LIC-SME/i.test(String(it.sku))) {
          it = { sku: smeReplacementSku(parseInt(tm[1], 10)), qty: it.qty };
          smeReplacedApplied = true;
        }
        if (parseInt(tm[1], 10) === t) {
          bucket.push(it);
          continue;
        }
        const newSku = rewriteSkuTerm(it.sku, t);
        if (newSku && newSku !== it.sku && newSku in prices) bucket.push({ sku: newSku, qty: it.qty });
        else return null;
      }
      buckets.push([String(t), bucket]);
    }
    filteredTerms = buckets;
  }
  const mutated = [];
  for (const [term, items] of filteredTerms) {
    let out = items;
    if (isHwOnly) out = applyHwOnly(out);
    else if (isLicOnly) out = applyLicOnly(out, term === "na" ? null : parseInt(term, 10));
    else if (compound && compound.mutationText) {
      const r = applyItemMutation(out, compound.mutationText, term === "na" ? null : parseInt(term, 10));
      if (r) out = r;
      else return null;
    } else if ((hasRemovePrefix || hasAddPrefix || hasSwapPrefix || isQtyChange || isUmbTypeSwap) && !isTermOnly) {
      const r = applyItemMutation(out, text, term === "na" ? null : parseInt(term, 10));
      if (r) out = r;
      else return null;
    }
    if (out.length > 0) mutated.push({ term, items: out });
  }
  if (mutated.length === 0) return null;
  const lines = [];
  const showPricing = isAddPricing || Boolean(compound);
  for (const { term, items } of mutated) {
    const url = buildStratusUrl(items);
    const label = term === "na" ? "" : `**${term}-Year Co-Term:** `;
    lines.push(`${label}${url}`);
    if (showPricing) {
      lines.push(buildPricingBlock(items, true));
    }
    lines.push("");
  }
  if (smeReplacedApplied || smeIngestSubstituted) lines.push(`_${SME_EOL_FLAG}_`, "");
  return lines.join("\n").trim();
}
__name(handleFollowUpModifier, "handleFollowUpModifier");
async function handlePricingRequest(text, personId, kv) {
  const upper = text.toUpperCase();
  const pricingIntent = /\b(COSTS?|PRICES?|PRICING|HOW MUCH|TOTAL|WHAT DOES .* COSTS?|WHAT IS THE COSTS?|WHAT('S| IS) THE PRICES?|CART TOTAL|BREAKDOWN|ESTIMATE|INCLUDE\s+(COST|COSTS|PRICE|PRICES|PRICING)|WITH\s+(COST|COSTS|PRICE|PRICES|PRICING))\b/i.test(text);
  if (!pricingIntent) return null;
  if (/\b(total cost of ownership|TCO|vs\s+\w+|versus|compared?\s+to|ROI)\b/i.test(text)) return null;
  if (/\b(pricing for|how much for|cost of)\s+(meraki|cisco|switches|aps?|access points?|cameras?|sensors?|firewalls?|routers?|networking)\s*$/i.test(text)) return null;
  const isDuoPricing = /\b(?:DUO|CISCO\s*DUO)\b/i.test(upper);
  const isUmbPricing = /\bUMBRELLA\b/i.test(upper);
  if (isDuoPricing || isUmbPricing) {
    const qtyMatch = upper.match(/\b(\d+)\b/);
    const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;
    if (isDuoPricing) {
      let duoTier = null;
      if (/ADVANTAGE/i.test(upper)) duoTier = "ADVANTAGE";
      else if (/PREMIER/i.test(upper)) duoTier = "PREMIER";
      else if (/ESSENTIAL/i.test(upper)) duoTier = "ESSENTIALS";
      if (duoTier) {
        const skus = [`LIC-DUO-${duoTier}-1YR`, `LIC-DUO-${duoTier}-3YR`, `LIC-DUO-${duoTier}-5YR`];
        const qtys = [qty, qty, qty];
        const label = `Cisco Duo ${duoTier.charAt(0) + duoTier.slice(1).toLowerCase()} \u2014 ${qty} license${qty > 1 ? "s" : ""}`;
        const resp = formatPricingResponse(label, skus, qtys);
        if (resp) return resp;
      }
    }
    if (isUmbPricing) {
      const isDns = /\bDNS\b/i.test(upper);
      const isSig = /\b(SIG|SECURE\s*INTERNET\s*GATEWAY)\b/i.test(upper);
      const isEss = /\bESS/i.test(upper);
      const isAdv = /\bADV/i.test(upper);
      let umbType = isDns ? "DNS" : isSig ? "SIG" : null;
      let umbTier = isEss ? "ESS" : isAdv ? "ADV" : null;
      if (umbType && umbTier) {
        const skus = [`LIC-UMB-${umbType}-${umbTier}-K9-1YR`, `LIC-UMB-${umbType}-${umbTier}-K9-3YR`, `LIC-UMB-${umbType}-${umbTier}-K9-5YR`];
        const qtys = [qty, qty, qty];
        const typeLabel = umbType === "DNS" ? "DNS Security" : "Secure Internet Gateway";
        const tierLabel = umbTier === "ESS" ? "Essentials" : "Advantage";
        const label = `Cisco Umbrella ${typeLabel} ${tierLabel} \u2014 ${qty} license${qty > 1 ? "s" : ""}`;
        const resp = formatPricingResponse(label, skus, qtys);
        if (resp) return resp;
      }
    }
  }
  const withLicenseMatch = text.match(/\bwith\s+(?:a\s+)?(?:(\d)\s*[-\s]?\s*year\s+)?(?:(?:ENT(?:ERPRISE)?|SEC(?:URITY)?|ADVANCED\s+SECURITY|SDW|SD[\s-]?WAN)\s+)?(license|licence|licensing|lic)\b/i);
  const trailingLicenseMatch = !withLicenseMatch && text.match(/\b(?:license|licence|licensing)s?\b/i);
  let licenseMode = null;
  if (withLicenseMatch) licenseMode = "bundle";
  else if (trailingLicenseMatch && !/\b(no|without)\s+licen/i.test(text)) licenseMode = "only";
  let licenseTerm = 3;
  if (licenseMode === "bundle" && withLicenseMatch && withLicenseMatch[1]) {
    licenseTerm = parseInt(withLicenseMatch[1]);
  } else if (licenseMode === "only") {
    const tm = text.match(/(\d)\s*[-\s]?\s*year/i);
    if (tm) licenseTerm = parseInt(tm[1]);
  }
  const licenseTierMatch = licenseMode && text.match(/\b(ENT(?:ERPRISE)?|SEC(?:URITY)?|ADVANCED\s+SECURITY|SDW|SD[\s-]?WAN)\s+(license|licence|licensing)/i);
  let licenseTierOverride = null;
  if (licenseTierMatch) {
    const t = licenseTierMatch[1].toUpperCase();
    if (/SEC|ADVANCED/.test(t)) licenseTierOverride = "SEC";
    else if (/ENT/.test(t)) licenseTierOverride = "ENT";
    else if (/SDW|SD.?WAN/.test(t)) licenseTierOverride = "SDW";
  }
  const wantsLicense = licenseMode !== null;
  const _licenseSkusFor = /* @__PURE__ */ __name((baseSku, term, tier) => {
    try {
      const cleanBase = baseSku.replace(/-(HW|MR|RTG|HW-NA)$/i, "");
      const lics = getLicenseSkus(cleanBase, tier);
      if (!lics) return [];
      const m = lics.find((l) => l.term === `${term}Y`);
      return m ? [m.sku] : [];
    } catch {
      return [];
    }
  }, "_licenseSkusFor");
  const directSkuMatch = text.match(/(?:cost|price|pricing|how much)(?:\s+(?:of|for))?\s+(\d+)\s*x?\s+([A-Z0-9][-A-Z0-9]+)/i);
  const singleSkuMatch = !directSkuMatch && text.match(/(?:cost|price|pricing|how much)(?:\s+(?:of|for|is|does))?\s+(?:an?\s+)?([A-Z0-9][-A-Z0-9]+)/i);
  if (directSkuMatch) {
    const qty = parseInt(directSkuMatch[1]);
    const sku = directSkuMatch[2].toUpperCase();
    const skus = [];
    const qtys = [];
    if (licenseMode !== "only") {
      skus.push(sku);
      qtys.push(qty);
    }
    if (wantsLicense) {
      for (const ls of _licenseSkusFor(sku, licenseTerm, licenseTierOverride)) {
        skus.push(ls);
        qtys.push(qty);
      }
    }
    if (skus.length > 0) {
      const resp = formatPricingResponse(null, skus, qtys);
      if (resp) return resp;
    }
  }
  if (singleSkuMatch) {
    const sku = singleSkuMatch[1].toUpperCase();
    if (!/^(OPTION|THE|THIS|THAT|MY|IT|A|AN)$/i.test(sku) && (/\d/.test(sku) || /^LIC-/i.test(sku))) {
      const skus = [];
      const qtys = [];
      if (licenseMode !== "only") {
        skus.push(sku);
        qtys.push(1);
      }
      if (wantsLicense) {
        for (const ls of _licenseSkusFor(sku, licenseTerm, licenseTierOverride)) {
          skus.push(ls);
          qtys.push(1);
        }
      }
      if (skus.length > 0) {
        const resp = formatPricingResponse(null, skus, qtys);
        if (resp) return resp;
      }
    }
  }
  const pronounRef = text.match(/(?:cost|price|pricing|how much)(?:\s+(?:of|for|is|does|are|would))?\s+(?:an?\s+|the\s+)?(that|those|this|these|it|them|the\s+switch(?:es)?|the\s+ap(?:s)?|the\s+access\s+point(?:s)?|the\s+firewall|the\s+camera(?:s)?|the\s+quote)\b/i);
  if (pronounRef && personId && kv) {
    const history2 = await getHistory(kv, personId);
    if (history2 && history2.length > 0) {
      const assistantMsgs2 = history2.filter((h) => h.role === "assistant").reverse();
      for (const m of assistantMsgs2) {
        const urlMatch = m.content.match(/stratusinfosystems\.com\/order\/\?item=([^\s&]+)&qty=([^\s)]+)/);
        if (urlMatch) {
          const skuList = urlMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
          const qtyList = urlMatch[2].split(",").map((q) => parseInt(q.trim(), 10));
          if (skuList.length > 0 && qtyList.length === skuList.length) {
            const finalSkus = skuList.slice();
            const finalQtys = qtyList.slice();
            if (wantsLicense) {
              for (let i = 0; i < skuList.length; i++) {
                const s = skuList[i];
                if (!s.toUpperCase().startsWith("LIC-")) {
                  for (const ls of _licenseSkusFor(s, licenseTerm, licenseTierOverride)) {
                    if (!finalSkus.some((e) => e.toUpperCase() === ls.toUpperCase())) {
                      finalSkus.push(ls);
                      finalQtys.push(qtyList[i]);
                    }
                  }
                }
              }
            }
            const resp = formatPricingResponse(null, finalSkus, finalQtys);
            if (resp) return resp;
          }
        }
      }
    }
  }
  const optionRef = text.match(/\b(?:OPTION\s+(1|2|3|A|B|B1|B2))\b/i);
  const termRef = text.match(/\b(\d)\s*-?\s*YEAR/i);
  if (!optionRef && !termRef) return null;
  if (!personId || !kv) return null;
  const history = await getHistory(kv, personId);
  if (history.length === 0) return null;
  const assistantMsgs = history.filter((h) => h.role === "assistant").reverse();
  if (assistantMsgs.length === 0) return null;
  let normalizedOpt = optionRef ? optionRef[1].toUpperCase() : null;
  if (normalizedOpt === "A") normalizedOpt = "1";
  if (normalizedOpt === "B1") normalizedOpt = "2";
  if (normalizedOpt === "B2") normalizedOpt = "3";
  if (normalizedOpt === "B") normalizedOpt = "2";
  let lastResponse = null;
  if (normalizedOpt) {
    const optKey = `OPTION ${normalizedOpt}`;
    lastResponse = assistantMsgs.find((m) => m.content.toUpperCase().includes(optKey))?.content;
    if (!lastResponse && optionRef) {
      const legacyKey = `OPTION ${optionRef[1].toUpperCase()}`;
      lastResponse = assistantMsgs.find((m) => m.content.toUpperCase().includes(legacyKey))?.content;
    }
  }
  if (!lastResponse && termRef) {
    lastResponse = assistantMsgs.find((m) => m.content.includes("stratusinfosystems.com/order/"))?.content;
  }
  if (!lastResponse) return null;
  const urlBlocks = [];
  const responseLines = lastResponse.split("\n");
  let currentLabel = "";
  for (const line of responseLines) {
    const trimmed = line.trim();
    if (/option\s+(\d|a|b|b1|b2)/i.test(trimmed)) {
      currentLabel = trimmed.replace(/[*:]+/g, "").trim();
    }
    const termLabel = trimmed.match(/^\**(\d-Year\s+Co-Term)\**:/i);
    if (termLabel) {
      const urlMatch = trimmed.match(/(https:\/\/stratusinfosystems\.com\/order\/\?[^\s]+)/);
      if (urlMatch) {
        urlBlocks.push({
          section: currentLabel,
          term: termLabel[1],
          url: urlMatch[1]
        });
      }
    }
    if (!termLabel) {
      const bareUrl = trimmed.match(/(https:\/\/stratusinfosystems\.com\/order\/\?[^\s]+)/);
      if (bareUrl && !urlBlocks.find((b) => b.url === bareUrl[1])) {
        urlBlocks.push({
          section: currentLabel,
          term: "",
          url: bareUrl[1]
        });
      }
    }
  }
  if (urlBlocks.length === 0) return null;
  let filtered = urlBlocks;
  if (normalizedOpt) {
    filtered = urlBlocks.filter((b) => {
      const su = b.section.toUpperCase();
      if (su.includes(`OPTION ${normalizedOpt}`)) return true;
      if (normalizedOpt === "1" && su.includes("OPTION A")) return true;
      if (normalizedOpt === "2" && (su.includes("OPTION B1") || su.includes("OPTION B") && !su.includes("B1") && !su.includes("B2"))) return true;
      if (normalizedOpt === "3" && su.includes("OPTION B2")) return true;
      return false;
    });
    if (normalizedOpt === "2" && filtered.length === 0) {
      filtered = urlBlocks.filter((b) => b.section.toUpperCase().includes("OPTION B") || b.section.toUpperCase().includes("OPTION 2"));
    }
  }
  if (termRef) {
    const termNum = termRef[1];
    const termFiltered = filtered.filter((b) => b.term.startsWith(termNum));
    if (termFiltered.length > 0) filtered = termFiltered;
  }
  if (filtered.length === 0) filtered = urlBlocks;
  const responses = [];
  for (const block of filtered) {
    const parsed = parseStratusUrl(block.url);
    if (!parsed) continue;
    const label = [block.section, block.term].filter(Boolean).join(" \u2014 ");
    const resp = formatPricingResponse(label || null, parsed.skus, parsed.qtys);
    if (resp) responses.push(resp);
  }
  if (responses.length === 0) return null;
  return responses.join("\n\n");
}
__name(handlePricingRequest, "handlePricingRequest");
function getRelevantPriceContext(text, history) {
  const skusToLookup = /* @__PURE__ */ new Set();
  const skuPattern = /\b([A-Z]{1,3}\d{1,4}[-A-Z0-9]*)\b/gi;
  let match;
  while ((match = skuPattern.exec(text)) !== null) {
    skusToLookup.add(match[1].toUpperCase());
  }
  if (history && history.length > 0) {
    const recentAssistant = history.filter((h) => h.role === "assistant").slice(-2);
    for (const msg of recentAssistant) {
      const urls = msg.content.match(/https:\/\/stratusinfosystems\.com\/order\/\?item=([^&\s]+)/g) || [];
      for (const url of urls) {
        const itemMatch = url.match(/item=([^&\s]+)/);
        if (itemMatch) {
          itemMatch[1].split(",").forEach((s) => skusToLookup.add(s.trim().toUpperCase()));
        }
      }
    }
  }
  if (skusToLookup.size === 0) return null;
  for (const sku of [...skusToLookup]) {
    const sm = sku.match(/^LIC-SME-([135])Y(R?)$/);
    if (sm) {
      skusToLookup.delete(sku);
      skusToLookup.add(smeReplacementSku(sm[1]));
    }
  }
  const priceLines = [];
  for (const sku of skusToLookup) {
    const p = getPrice(sku);
    if (p) {
      priceLines.push(`${sku}: $${p.price.toLocaleString("en-US", { minimumFractionDigits: 2 })} (list: $${p.list.toLocaleString("en-US", { minimumFractionDigits: 2 })})`);
    }
  }
  if (priceLines.length === 0) return null;
  return `## RELEVANT PRICING (Stratus eComm prices)
Use these prices when the user asks about costs, pricing, or totals. Show itemized breakdowns with per-unit and line totals.
${priceLines.join("\n")}`;
}
__name(getRelevantPriceContext, "getRelevantPriceContext");
var accessories = accessories_default;
var portProfiles = accessories.port_profiles;
var sfpModules = accessories.sfp_modules;
var stackingData = accessories.stacking;
var uplinkModules = accessories.uplink_modules;
function getPortProfile(deviceModel) {
  const upper = deviceModel.toUpperCase().replace(/-HW(-NA)?$/, "").replace(/-MR$/, "").replace(/-RTG$/, "");
  for (const [family, models] of Object.entries(portProfiles)) {
    if (models[upper]) return { profile: models[upper], family, model: upper };
    if (models[upper + "-M"]) return { profile: models[upper + "-M"], family, model: upper + "-M" };
    const noM = upper.replace(/-M$/, "");
    if (models[noM]) return { profile: models[noM], family, model: noM };
  }
  return null;
}
__name(getPortProfile, "getPortProfile");
function getStackingSuggestion(baseSku, qty) {
  if (qty < 2) return null;
  const profile = getPortProfile(baseSku);
  if (!profile || !profile.profile.stackable) return null;
  const stackType = profile.profile.stack_type;
  if (!stackType) return null;
  const stackFamily = stackingData.families[stackType];
  if (!stackFamily) return null;
  const defaultCable = Object.entries(stackFamily.cables).find(([_, v]) => v.use_case && v.use_case.includes("default"));
  const cableSku = defaultCable ? defaultCable[0] : Object.keys(stackFamily.cables)[1];
  const cableQty = qty;
  const result = {
    stackType,
    bandwidth: stackFamily.bandwidth,
    maxStackSize: stackFamily.max_stack_size,
    cableSku,
    cableQty,
    topology: "ring (recommended)",
    note: `${qty} ${baseSku} can be stacked. Ring topology needs ${qty} cables.`
  };
  if (stackFamily.requires_kit) {
    result.kitSku = stackFamily.requires_kit;
    result.kitQty = qty;
    result.kitNote = stackFamily.kit_note;
  }
  if (stackFamily.stackpower) {
    result.stackpower = stackFamily.stackpower;
  }
  return result;
}
__name(getStackingSuggestion, "getStackingSuggestion");
function buildStackingSuggestionLine(baseSku, qty) {
  const suggestion = getStackingSuggestion(baseSku, qty);
  if (!suggestion) return null;
  let line = `\u{1F4A1} **Stacking:** ${qty}x ${baseSku} can be stacked (${suggestion.bandwidth}). `;
  line += `Ring topology needs ${suggestion.cableQty}x ${suggestion.cableSku}.`;
  if (suggestion.kitSku) {
    line += ` Each switch also requires 1x ${suggestion.kitSku} stacking module.`;
  }
  return line;
}
__name(buildStackingSuggestionLine, "buildStackingSuggestionLine");
function getAccessoriesContext(userMessage) {
  const upper = userMessage.toUpperCase();
  const accessoryIntent = /\b(SFP|OPTIC|TRANSCEIVER|FIBER|DAC|TWINAX|STACK(ING)?|UPLINK|MODULE|CONNECT|INTERCONNECT|CABLE|PORT|COMPATIBLE|COMPATIBILITY)\b/i.test(userMessage);
  const designIntent = /\b(CONNECT .+ TO|BETWEEN .+ AND|LINK .+ (TO|WITH)|UPLINK .+ (TO|FROM)|HOOK UP|TIE .+ TOGETHER)\b/i.test(userMessage);
  if (!accessoryIntent && !designIntent) return null;
  const devicePatterns = [
    /MX\d+[A-Z]*/gi,
    /MS\d{3}[A-Z]?-[\dA-Z-]+/gi,
    /MS\d{3}/gi,
    /C9[23]\d{2}[LX]?(?:-[\dA-Z]+-[\dA-Z]+)?(?:-M)?/gi,
    /MR\d+[A-Z]*/gi,
    /CW9\d{3}[A-Z]*/gi
  ];
  const mentionedDevices = /* @__PURE__ */ new Set();
  for (const pattern of devicePatterns) {
    let match;
    while ((match = pattern.exec(upper)) !== null) {
      mentionedDevices.add(match[0]);
    }
  }
  let context = "## ACCESSORY & CONNECTIVITY REFERENCE\n";
  context += "Use this data when answering questions about SFPs, stacking cables, uplink modules, or device connectivity.\n\n";
  if (mentionedDevices.size > 0) {
    context += "### Device Port Profiles\n";
    for (const dev of mentionedDevices) {
      const profile = getPortProfile(dev);
      if (profile) {
        context += `${profile.model} (${profile.family}): ${JSON.stringify(profile.profile)}
`;
      }
    }
    context += "\n";
  }
  if (/\b(SFP|OPTIC|TRANSCEIVER|FIBER|DAC|TWINAX)\b/i.test(userMessage)) {
    context += "### SFP Module Catalog\n";
    for (const [category, modules] of Object.entries(sfpModules)) {
      context += `${category}: ${modules.map((m) => `${m.sku} (${m.medium}, ${m.range})`).join(", ")}
`;
    }
    context += "\n";
  }
  if (/\b(STACK|STACKING)\b/i.test(userMessage)) {
    context += "### Stacking Cable Families\n";
    for (const [type, family] of Object.entries(stackingData.families)) {
      context += `${type} (${family.bandwidth}): ${family.compatible_switches.join(", ")} \u2014 cables: ${Object.keys(family.cables).join(", ")}
`;
    }
    context += `Not stackable: ${stackingData.not_stackable.join(", ")}

`;
  }
  if (/\b(MODULE|UPLINK|MS390|C9300|MODULAR)\b/i.test(userMessage)) {
    context += "### Uplink Modules (Modular Devices)\n";
    for (const [platform, data] of Object.entries(uplinkModules)) {
      context += `${platform}: ${data.modules.map((m) => `${m.sku} (${m.ports}x ${m.speed} ${m.type})`).join(", ")} \u2014 ${data.note}
`;
    }
    context += "\n";
  }
  context += "### Design Rules\n";
  context += accessories.design_rules.matching.join("\n") + "\n";
  context += accessories.design_rules.common_mistakes.join("\n") + "\n";
  return context;
}
__name(getAccessoriesContext, "getAccessoriesContext");
var WORD_NUMBERS = {
  ZERO: 0,
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
  SIX: 6,
  SEVEN: 7,
  EIGHT: 8,
  NINE: 9,
  TEN: 10,
  ELEVEN: 11,
  TWELVE: 12,
  THIRTEEN: 13,
  FOURTEEN: 14,
  FIFTEEN: 15,
  SIXTEEN: 16,
  SEVENTEEN: 17,
  EIGHTEEN: 18,
  NINETEEN: 19,
  TWENTY: 20,
  THIRTY: 30,
  FORTY: 40,
  FIFTY: 50,
  SIXTY: 60,
  SEVENTY: 70,
  EIGHTY: 80,
  NINETY: 90,
  HUNDRED: 100
};
function convertWordNumbers(text) {
  let result = text;
  result = result.replace(/\bhalf\s+(?:a\s+)?dozen\b/gi, "6");
  result = result.replace(/\ba\s+dozen\b/gi, "12");
  result = result.replace(/\bdozen\b/gi, "12");
  result = result.replace(/\ba\s+couple\s+(?:of\s+)?/gi, "2 ");
  result = result.replace(/\ba\s+couple\b/gi, "2");
  const tens = "TWENTY|THIRTY|FORTY|FIFTY|SIXTY|SEVENTY|EIGHTY|NINETY";
  const ones = "ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE";
  const compoundRe = new RegExp(`\\b(${tens})[\\s-]+(${ones})\\b`, "gi");
  result = result.replace(compoundRe, (_, t, o) => {
    return String(WORD_NUMBERS[t.toUpperCase()] + WORD_NUMBERS[o.toUpperCase()]);
  });
  const allWords = Object.keys(WORD_NUMBERS).join("|");
  const simpleRe = new RegExp(`\\b(${allWords})\\b`, "gi");
  result = result.replace(simpleRe, (m) => {
    const val = WORD_NUMBERS[m.toUpperCase()];
    return val !== void 0 ? String(val) : m;
  });
  return result;
}
__name(convertWordNumbers, "convertWordNumbers");
var SME_REPLACEMENT_BASE = "LIC-MI-EMSC-D-1YMC-A";
var SME_EOL_FLAG = "Cisco Meraki Systems Manager (LIC-SME) licenses are discontinued \u2014 quoted the replacement, Ivanti Neurons for MDM per device (MI-EMSC-D-1YMC-A), at the requested term.";
function smeReplacementSku(term) {
  const t = parseInt(term, 10);
  const valid = t === 1 || t === 3 || t === 5 ? t : 3;
  return `${SME_REPLACEMENT_BASE}-${valid}YR`;
}
__name(smeReplacementSku, "smeReplacementSku");
var IVANTI_URL = "https://www.stratusinfosystems.com/shop/product/ivanti-neurons-for-mdm-per-device";
var IVANTI_MIN = 50;
var INSIGHT_RE = /^LIC-MI-[SML]-\d+(YR|Y)?$/i;
function eolPick(base, n, unit) {
  const order = String(unit).toUpperCase() === "Y" ? ["Y", "YR"] : ["YR", "Y"];
  for (const u of order) {
    const c = `${base}-${n}${u}`;
    if (prices[c]) return c;
  }
  return `${base}-${n}${String(unit).toUpperCase()}`;
}
__name(eolPick, "eolPick");
function eolEdition(mxEdition, lines) {
  const e = String(mxEdition || "").toLowerCase();
  if (e.includes("advanced security") || e === "sec") return "SEC";
  if (e.includes("enterprise") || e === "ent") return "ENT";
  if (lines.some((l) => /^LIC-MX\w+-SEC-/i.test(String(l.sku)))) return "SEC";
  if (lines.some((l) => /^LIC-MX\w+-ENT-/i.test(String(l.sku)))) return "ENT";
  return "ENT";
}
__name(eolEdition, "eolEdition");
function applyEolSwaps(lines, mxEdition) {
  const src = Array.isArray(lines) ? lines : [];
  const ed = eolEdition(mxEdition, src);
  let insightNote = false;
  let smeReplacedThisPass = false;
  const vmxSwappedThisPass = [];
  const upgradeMxToSdw = src.some((l) => INSIGHT_RE.test(String(l.sku || "")));
  let out = [];
  for (const l of src) {
    const sku = String(l.sku || "").toUpperCase();
    let m;
    if (INSIGHT_RE.test(sku)) {
      insightNote = true;
      continue;
    }
    if (m = sku.match(/^LIC-VMX-(S|M|L|XL)-(\d+)(YR|Y)$/)) {
      const swappedSku = eolPick(`LIC-VMX-${m[1]}-${ed}`, m[2], "Y");
      vmxSwappedThisPass.push(swappedSku);
      out.push({
        ...l,
        sku: swappedSku,
        flag: `vMX now requires an edition; set to ${ed}`,
        replaced_from: sku
      });
      continue;
    }
    if (/^LIC-VMX\d/.test(sku)) {
      out.push({
        ...l,
        sku,
        valid: false,
        flag: `retired vMX; pick a sized LIC-VMX-{S/M/L/XL}-${ed} equivalent`
      });
      continue;
    }
    if (m = sku.match(/^LIC-SME?-(\d+)(YR|Y)$/)) {
      smeReplacedThisPass = true;
      out.push({
        ...l,
        sku: `${SME_REPLACEMENT_BASE}-${m[1]}YR`,
        qty: Number(l.qty) || 0,
        flag: `Systems Manager retired; Ivanti Neurons for MDM (min ${IVANTI_MIN})`,
        replaced_from: sku,
        url: IVANTI_URL
      });
      continue;
    }
    out.push(l);
  }
  let upgraded = 0;
  if (upgradeMxToSdw) out = out.map((l) => {
    const m = String(l.sku || "").match(/^LIC-(MX\w+)-SEC-(\d+)(YR|Y)$/i);
    if (m) {
      upgraded++;
      return {
        ...l,
        sku: eolPick(`LIC-${m[1].toUpperCase()}-SDW`, m[2], m[3]),
        flag: "Meraki Insight retired; upgraded to SD-WAN Plus (SDW)",
        replaced_from: String(l.sku).toUpperCase()
      };
    }
    return l;
  });
  let anyFloorRaise = false;
  {
    const groups = /* @__PURE__ */ new Map();
    out.forEach((l, i) => {
      const s = String(l.sku || "").toUpperCase();
      if (s.startsWith(SME_REPLACEMENT_BASE)) {
        if (!groups.has(s)) groups.set(s, []);
        groups.get(s).push(i);
      }
    });
    if (groups.size > 0) {
      const dropIdx = /* @__PURE__ */ new Set();
      for (const [, idxs] of groups) {
        const sum = idxs.reduce((a, i) => a + (Number(out[i].qty) || 0), 0);
        const floored = Math.max(sum, IVANTI_MIN);
        const raised = floored > sum;
        if (raised) anyFloorRaise = true;
        const first = out[idxs[0]];
        out[idxs[0]] = {
          ...first,
          qty: floored,
          url: IVANTI_URL,
          flag: `${first.flag ? first.flag : `Ivanti Neurons for MDM (min ${IVANTI_MIN})`}${raised ? `, qty raised from ${sum}` : ""}`
        };
        for (let k = 1; k < idxs.length; k++) dropIdx.add(idxs[k]);
      }
      if (dropIdx.size > 0) out = out.filter((_, i) => !dropIdx.has(i));
    }
  }
  const notes = [];
  if (smeReplacedThisPass) notes.push(SME_EOL_FLAG);
  if (anyFloorRaise) {
    notes.push(`Ivanti Neurons for MDM has a ${IVANTI_MIN}-device minimum \u2014 the quantity was raised to ${IVANTI_MIN}.`);
  }
  if (insightNote) notes.push(upgraded ? `Meraki Insight is retired; upgraded ${upgraded} MX license line${upgraded === 1 ? "" : "s"} to SD-WAN Plus (SDW) to preserve the feature set.` : "Meraki Insight is retired and was removed from the quote; no MX Advanced Security line to upgrade to SD-WAN Plus \u2014 please review.");
  if (vmxSwappedThisPass.length > 0) {
    notes.push(`vMX licenses now require an edition \u2014 quoted ${vmxSwappedThisPass[0]} (${ed}).`);
  }
  if (out.some((l) => l.url === IVANTI_URL)) notes.push(`Ivanti Neurons for MDM: ${IVANTI_URL}`);
  return { lines: out, notes, ivantiUrl: out.some((l) => l.url === IVANTI_URL) ? IVANTI_URL : null };
}
__name(applyEolSwaps, "applyEolSwaps");
var swapEolUrlsInText = /* @__PURE__ */ __name((s) => String(s || "").replace(/https:\/\/stratusinfosystems\.com\/order\/\?[^\s)>\]"'<]+/g, (u) => {
  try {
    const parsed = parseStratusUrl(u);
    if (!parsed || parsed.skus.length === 0) {
      return /[?&]item=[^&\s]/.test(u) ? "[order link removed \u2014 the quoted product is retired; ask for an updated quote]" : u;
    }
    return buildStratusUrl(parsed.skus.map((sku, i) => ({ sku, qty: parsed.qtys[i] })));
  } catch {
    return u;
  }
}), "swapEolUrlsInText");
function findBareSmeMention(upper) {
  const smeRe = /(?:(\d+)\s*[X×]?\s*)?(?:LIC-SME\b(?!-\d+YR?\b)|(?<![-A-Za-z0-9])SME\b|SYSTEMS?\s+MANAGER\b)/gi;
  const m = smeRe.exec(String(upper || ""));
  if (!m) return null;
  return { qty: m[1] ? parseInt(m[1], 10) : 1, position: m.index };
}
__name(findBareSmeMention, "findBareSmeMention");
function hasOtherQuoteSkuForSme(upper) {
  return /\b(?:C9[23]\d{2}[LX]?-[\dA-Z]+-[\dA-Z]+-M(?:-O)?|C8[14]\d{2}-G2-MX|MA-[A-Z0-9-]+|CW9\d{3}[A-Z0-9]*|MS150-[\dA-Z]+-[\dA-Z]+|MS450-\d+|MS[12345]\d{2}R?-[\dA-Z]+(?:-I)?(?:-RF)?|(?:MR|MV|MT|MG)\d+[A-Z]?(?![A-Z])|MX\d+[A-Z]*(?:-NA)?|Z\d+[A-Z]*|LIC-(?!SME\b)[A-Z0-9-]+)\b/i.test(String(upper || ""));
}
__name(hasOtherQuoteSkuForSme, "hasOtherQuoteSkuForSme");
function extractEmbeddedDirectLicenseList(rawText) {
  const text = String(rawText || "");
  if (/stratusinfosystems\.com\/order\/|stratus\.supply\/|[?&]item=/i.test(text)) return null;
  const explicitQuoteIntent = /\b(?:QUOTE|PRICE|PRICING|CART|ORDER|RENEW|RENEWAL|CO-?TERM|COTERM)\b/i.test(text);
  const advisoryContext = /\b(?:COMPARE|COMPARISON|DIFFEREN(?:CE|CES|T)|VERSUS|VS\.?|WHICH|EXPLAIN|DESCRIBE|RECOMMEND(?:ED|ATION)?|BEST|BETTER|WORSE)\b/i.test(text) || /\bLIC-[A-Z0-9-]+\b\s+OR\s+\bLIC-[A-Z0-9-]+\b/i.test(text) || /\?/.test(text) && /\b(?:WHAT(?:'S| IS)|HOW (?:DO|DOES|WOULD|SHOULD)|IS|ARE|CAN YOU|COULD YOU|SHOULD I|DO I NEED)\b/i.test(text);
  if (!explicitQuoteIntent && advisoryContext) return null;
  if (/\b(?:CHANGE|UPDATE|SWAP|REPLACE|MOVE|INCREASE|DECREASE|UPGRADE|DOWNGRADE)\b/i.test(text) && /\b(?:FROM|TO)\s+(?:LIC-[A-Z0-9-]+|\d{1,5})\b/i.test(text)) return null;
  const matches = [...text.matchAll(/\bLIC-[A-Z0-9-]+\b/gi)];
  if (matches.length < 2) return null;
  const textWithoutLicenseSkus = text.replace(/\bLIC-[A-Z0-9-]+\b/gi, " ");
  if (/\b(?:C9[23]\d{2}[LX]?-[\dA-Z]+-[\dA-Z]+-M(?:-O)?|C8[14]\d{2}-G2-MX|MA-[A-Z0-9-]+|CW9\d{3}[A-Z0-9]*|MS150-[\dA-Z]+-[\dA-Z]+|MS450-\d+|MS[12345]\d{2}R?-[\dA-Z]+(?:-I)?(?:-RF)?|(?:MR|MV|MT|MG)\d+[A-Z]?(?![A-Z])|MX\d+[A-Z]*(?:-NA)?|Z\d+[A-Z]*)\b/i.test(textWithoutLicenseSkus)) return null;
  const items = [];
  for (const match of matches) {
    const sku = match[0].toUpperCase();
    const before = text.slice(Math.max(0, match.index - 48), match.index);
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 48);
    const afterQty = after.match(/^\s*(?:[xX×]\s*|(?:QTY|QUANTITY)\s*[:=]?\s*|[:=]\s*|[-–—]\s*)(\d{1,5})(?:\s*\)|\s*\]|\b)/i) || after.match(/^\s*[\(\[]\s*(\d{1,5})\s*[\)\]]/);
    const beforeRaw = before.match(/(^|[^A-Z0-9-])(\d{1,5})\s*(?:[xX×]\s*)?$/i);
    const beforeQty = beforeRaw && !/[$€£¥]/.test(beforeRaw[1]) ? beforeRaw : null;
    let qty = 1;
    if (afterQty) qty = parseInt(afterQty[1], 10);
    else if (beforeQty) qty = parseInt(beforeQty[2], 10);
    items.push({ sku, qty: Number.isFinite(qty) && qty > 0 ? qty : 1 });
  }
  const seen = /* @__PURE__ */ new Set();
  const deduped = [];
  for (const item of items) {
    if (seen.has(item.sku)) continue;
    seen.add(item.sku);
    deduped.push(item);
  }
  return deduped.length >= 2 ? deduped : null;
}
__name(extractEmbeddedDirectLicenseList, "extractEmbeddedDirectLicenseList");
function buildQuoteFromV2(v2, rawText) {
  if (!v2 || typeof v2 !== "object") return null;
  if (v2.intent !== "quote") return null;
  const rawStr = typeof rawText === "string" ? rawText : "";
  if (/\b(C9[23]\d{2}[LX]?|C8[14]\d{2})\b/i.test(rawStr)) return null;
  if (/\bMA-[A-Z0-9]/i.test(rawStr)) return null;
  if (/\b\d+\s*(MR|MV|MT)(?:'?S)?\s+(LICENSE|LICENCE|LISCENSE|LIC|RENEWAL)/i.test(rawStr)) return null;
  if (/\b(LICENSE|LICENCE|LIC|RENEWAL)S?\s+(FOR\s+)?(MR|MV|MT)\b(?!\d)/i.test(rawStr)) return null;
  if (/^(?:QUOTE\s+)?(MR|MV|MT)\s+(LICENSE|LICENCE|LIC|RENEWAL)/i.test(rawStr.trim())) return null;
  if (findBareSmeMention(rawStr.toUpperCase()) || /\bLIC-SME-\d+YR?\b/i.test(rawStr)) return null;
  if (/\b(MS150|MS130|MS390|MS450)\b(?!-)/i.test(rawStr)) return null;
  if (/\b(C9300L?|C9200L)\b(?!-)/i.test(rawStr)) return null;
  if (/\bCW\b(?!\d)/i.test(rawStr)) return null;
  if (/\b(WI[-\s]?FI|WIFI)\s*(6E|6|7)\s+(AP|APS|ACCESS)/i.test(rawStr)) return null;
  const ref = v2.reference && typeof v2.reference === "object" ? v2.reference : {};
  if (ref.is_pronoun_ref === true || ref.resolve_from_history === true) return null;
  const items = Array.isArray(v2.items) ? v2.items.filter((i) => i && i.sku) : [];
  if (items.length === 0) return null;
  const mods = v2.modifiers && typeof v2.modifiers === "object" ? v2.modifiers : {};
  const showPricing = Boolean(mods.show_pricing);
  const hwItems = [];
  const licItems = [];
  for (const it of items) {
    const sku = String(it.sku).toUpperCase().trim();
    if (!sku) continue;
    const qty = Number.isFinite(Number(it.qty)) && Number(it.qty) > 0 ? Math.floor(Number(it.qty)) : 1;
    const isLicense = it.sku_type === "license" || sku.startsWith("LIC-");
    if (isLicense) licItems.push({ sku, qty });
    else hwItems.push({ sku, qty });
  }
  for (const lic of licItems) {
    if (!(lic.sku in prices)) return null;
  }
  const rawForDetect = String(rawText || "");
  const separateQuotesRegex = /\b(?:as\s+)?separate\s+(?:quote|quotes|url|urls|link|links)\b|\bindividual\s+(?:quote|quotes|url|urls|link|links)\b|\beach\s+as\s+(?:its|their)\s+own\s+(?:quote|url|link)\b|\bsplit\s+(?:these\s+|them\s+)?into\s+separate\b|\bone\s+per\s+line\b|\bbreak\s+(?:these|them)\s+out\b/i;
  const separateQuotes = Boolean(mods.separate_quotes) || separateQuotesRegex.test(rawForDetect);
  if (hwItems.length === 0 && licItems.length > 0) {
    let _acClamped = false;
    for (const it of licItems) {
      if (/^LIC-L-AC-(APX|PLS)-\d+Y-S1$/i.test(String(it.sku || "")) && Number(it.qty) < 25) {
        it.qty = 25;
        _acClamped = true;
      }
    }
    if (licItems.length === 1) {
      let _loneSku = licItems[0].sku;
      const _loneSmeM = String(_loneSku).match(/^LIC-SME-([135])Y(R)?$/i);
      if (_loneSmeM) _loneSku = smeReplacementSku(_loneSmeM[1]);
      const _loneTermM = _loneSku.match(/-([135])(YR|Y-S\d+|Y)$/i);
      if (_loneTermM && !shouldPreserveTypedDirectLicenseTerm(rawStr, _loneSku)) {
        const _expanded = [];
        for (const t of [1, 3, 5]) {
          const s = parseInt(_loneTermM[1], 10) === t ? _loneSku : rewriteSkuTerm(_loneSku, t);
          if (s && s in prices) _expanded.push({ baseSku: s, qty: licItems[0].qty, isLicenseOnly: true });
        }
        if (_expanded.length >= 2) {
          return {
            items: _expanded,
            isQuote: true,
            isTermOptionQuote: true,
            modifiers: { hardwareOnly: false, licenseOnly: true, separateQuotes },
            requestedTier: null,
            isAdvisory: false,
            isRevision: false,
            showPricing,
            unresolvedCategories: [],
            clarificationNote: _acClamped ? "AnyConnect has a 25-user minimum \u2014 bumped quantity to 25." : void 0,
            _fromV2: true
          };
        }
      }
      return {
        items: [],
        directLicense: { sku: licItems[0].sku, qty: licItems[0].qty },
        requestedTerm: null,
        modifiers: { hardwareOnly: false, licenseOnly: true, separateQuotes },
        requestedTier: null,
        isAdvisory: false,
        isRevision: false,
        showPricing,
        unresolvedCategories: [],
        clarificationNote: _acClamped ? "AnyConnect has a 25-user minimum \u2014 bumped quantity to 25." : void 0,
        _fromV2: true
      };
    }
    const byKey = /* @__PURE__ */ new Map();
    for (const it of licItems) {
      const prev = byKey.get(it.sku);
      if (!prev || it.qty > prev.qty) byKey.set(it.sku, it);
    }
    const dedup = [...byKey.values()];
    if (separateQuotes) {
      return {
        items: dedup.map((l) => ({ baseSku: l.sku, qty: l.qty, isLicenseOnly: true })),
        isQuote: true,
        isTermOptionQuote: true,
        modifiers: { hardwareOnly: false, licenseOnly: true, separateQuotes: true },
        requestedTier: null,
        isAdvisory: false,
        isRevision: false,
        showPricing,
        unresolvedCategories: [],
        clarificationNote: _acClamped ? "AnyConnect has a 25-user minimum \u2014 bumped quantity to 25." : void 0,
        _fromV2: true
      };
    }
    const _termRe = /-(\d+)Y(?:R|-S\d+)?$/i;
    const _allHaveTerms = dedup.every((l) => _termRe.test(String(l.sku || "")));
    const _termSet = /* @__PURE__ */ new Set();
    dedup.forEach((l) => {
      const m = String(l.sku || "").match(_termRe);
      if (m) _termSet.add(m[1]);
    });
    if (_allHaveTerms && _termSet.size > 1) {
      return {
        items: dedup.map((l) => ({ baseSku: l.sku, qty: l.qty, isLicenseOnly: true })),
        isQuote: true,
        isTermOptionQuote: true,
        modifiers: { hardwareOnly: false, licenseOnly: true, separateQuotes: false },
        requestedTier: null,
        isAdvisory: false,
        isRevision: false,
        showPricing,
        unresolvedCategories: [],
        clarificationNote: _acClamped ? "AnyConnect has a 25-user minimum \u2014 bumped quantity to 25." : void 0,
        _fromV2: true
      };
    }
    return {
      items: [],
      directLicenseList: dedup,
      requestedTerm: null,
      modifiers: { hardwareOnly: false, licenseOnly: true, separateQuotes },
      requestedTier: null,
      isAdvisory: false,
      isRevision: false,
      showPricing,
      unresolvedCategories: [],
      clarificationNote: _acClamped ? "AnyConnect has a 25-user minimum \u2014 bumped quantity to 25." : void 0,
      _fromV2: true
    };
  }
  const normHw = [];
  const seen = /* @__PURE__ */ new Set();
  for (const it of hwItems) {
    let base = it.sku.replace(/-(HW|MR|RTG)(-NA)?$/i, (m, _a, na) => na ? na : "").replace(/-(SEC|ENT|SDW|SD-WAN)$/i, "").trim();
    if (!base) continue;
    if (seen.has(base)) {
      const prev = normHw.find((x) => x.baseSku === base);
      if (prev && it.qty > prev.qty) prev.qty = it.qty;
      continue;
    }
    seen.add(base);
    normHw.push({ baseSku: base, qty: it.qty });
  }
  if (normHw.length === 0 && licItems.length === 0) return null;
  let requestedTerm = null;
  if (!mods.all_terms) {
    const t = parseInt(mods.term_years, 10);
    if ([1, 3, 5].includes(t)) requestedTerm = t;
  }
  const requestedTier = normalizeRequestedTier(mods.tier, rawText);
  if (requestedTerm == null && licItems.length > 0 && !mods.all_terms) {
    for (const lic of licItems) {
      const termMatch = lic.sku.match(/-([135])Y(?:R|-S\d+)?$/);
      if (termMatch) {
        const impliedTerm = parseInt(termMatch[1], 10);
        if ([1, 3, 5].includes(impliedTerm)) {
          requestedTerm = impliedTerm;
          break;
        }
      }
    }
  }
  return {
    items: normHw,
    requestedTerm,
    modifiers: {
      hardwareOnly: Boolean(mods.hardware_only),
      licenseOnly: Boolean(mods.license_only),
      separateQuotes
    },
    requestedTier,
    isAdvisory: false,
    isRevision: false,
    showPricing,
    unresolvedCategories: [],
    _fromV2: true
  };
}
__name(buildQuoteFromV2, "buildQuoteFromV2");
var V3_TIER_WORD = { SEC: "SEC", SDW: "SD-WAN", ENT: "enterprise", A: "advanced" };
function synthV3Item(product, intent, qty, tier) {
  let base = `${qty} ${product}`;
  if (tier && V3_TIER_WORD[tier]) base += ` ${V3_TIER_WORD[tier]}`;
  if (intent === "license") return `${base} license`;
  if (intent === "hardware") return `${base} hardware only`;
  return base;
}
__name(synthV3Item, "synthV3Item");
function buildQuoteFromV3(v3, rawText) {
  if (!v3 || typeof v3 !== "object") return null;
  if (v3.clarify && v3.clarify.needed === true) {
    return { isClarification: true, clarificationMessage: v3.clarify.question || "", _fromV3: true };
  }
  const items = Array.isArray(v3.items) ? v3.items : [];
  if (!items.length) return null;
  const mods = v3.modifiers || {};
  const textHasHwOnly = /\b(hardware\s+only|hw\s+only|just\s+the\s+hardware|without\s+(a\s+)?licen[cs]e|no\s+licen[cs]e)\b/i.test(String(rawText || ""));
  let requestedTerm = null;
  if (!mods.all_terms) {
    const t = parseInt(mods.term_years, 10);
    if ([1, 3, 5].includes(t)) requestedTerm = t;
  }
  const combinedItems = [];
  let resolvedTier = null;
  let capNote = null;
  for (const it of items) {
    const product = String(it.product || "").trim();
    if (!product) continue;
    const intent = it.intent === "hardware" ? "hardware" : it.intent === "license" ? "license" : "normal";
    const qty = Number.isFinite(Number(it.qty)) && Number(it.qty) > 0 ? Math.floor(Number(it.qty)) : 1;
    const synthetic = synthV3Item(product, intent, qty, mods.tier);
    let p;
    try {
      p = parseMessage(synthetic);
    } catch {
      return null;
    }
    if (!p) continue;
    p = preserveMsAdvancedTier(p, synthetic);
    if (p.isClarification && p.clarificationMessage) {
      return { isClarification: true, clarificationMessage: p.clarificationMessage, _fromV3: true };
    }
    if (p.requestedTier && !resolvedTier) resolvedTier = p.requestedTier;
    const note = [p.clarificationNote, p.note].filter(Boolean).join(" ");
    if (note && !capNote) capNote = note;
    let licEntries = null;
    if (p.directLicense && p.directLicense.sku) licEntries = [{ sku: p.directLicense.sku, qty: p.directLicense.qty }];
    else if (Array.isArray(p.directLicenseList) && p.directLicenseList.length) licEntries = p.directLicenseList.map((e) => ({ sku: e.sku, qty: e.qty }));
    else if (p.isTermOptionQuote && Array.isArray(p.items)) licEntries = p.items.map((e) => ({ sku: e.baseSku, qty: e.qty }));
    if (licEntries) {
      const _sw = applyEolSwaps(licEntries);
      licEntries = _sw.lines.filter((l) => l.valid !== false);
      const _swNotes = [
        ..._sw.notes,
        ..._sw.lines.filter((l) => l.valid === false && l.flag).map((l) => `${l.sku}: ${l.flag}.`)
      ];
      if (_swNotes.length) {
        const merged = _swNotes.join(" ");
        capNote = capNote ? `${capNote} ${merged}` : merged;
      }
      const byBase = /* @__PURE__ */ new Map();
      for (const e of licEntries) {
        const m = String(e.sku || "").match(/^(LIC-.+?)-([135])Y(?:R)?(?:-S\d+)?$/i);
        if (!m) {
          combinedItems.push({ baseSku: e.sku, qty: e.qty || qty, hardwareOnly: false, licenseOnly: true });
          continue;
        }
        const base = m[1].toUpperCase();
        if (!byBase.has(base)) byBase.set(base, { qty: e.qty || qty, licenseSkus: [], sme: base === SME_REPLACEMENT_BASE });
        byBase.get(base).licenseSkus.push({ term: `${m[2]}Y`, sku: e.sku });
      }
      for (const [base, info] of byBase) {
        combinedItems.push({ baseSku: base, qty: info.qty, _v3PreLicense: info.licenseSkus, smeReplaced: info.sme, hardwareOnly: false, licenseOnly: true });
      }
      continue;
    }
    if (!Array.isArray(p.items)) continue;
    for (const pi of p.items) {
      pi.hardwareOnly = intent === "hardware" && textHasHwOnly;
      pi.licenseOnly = intent === "license";
      combinedItems.push(pi);
    }
  }
  if (!combinedItems.length) return null;
  return {
    items: combinedItems,
    requestedTerm,
    modifiers: {
      hardwareOnly: false,
      // global default — per-item flags override via the ?? gates
      licenseOnly: false,
      separateQuotes: Boolean(mods.separate_quotes)
    },
    requestedTier: resolvedTier || normalizeRequestedTier(mods.tier, rawText),
    isAdvisory: false,
    isRevision: false,
    showPricing: Boolean(mods.show_pricing),
    clarificationNote: capNote || void 0,
    unresolvedCategories: [],
    _fromV3: true
  };
}
__name(buildQuoteFromV3, "buildQuoteFromV3");
function parseExplicitDirectLicenseListBeforeClassifier(rawText) {
  const upper = String(rawText || "").toUpperCase().replace(/HTTPS?:\/\/\S+/g, " ");
  const explicitLicTerms = upper.match(/\bLIC-[A-Z0-9-]+-[135]YR?\b/g) || [];
  if (new Set(explicitLicTerms).size < 2) return null;
  try {
    const parsed = parseMessage(rawText);
    return parsed && Array.isArray(parsed.directLicenseList) && parsed.directLicenseList.length >= 2 ? parsed : null;
  } catch (_) {
    return null;
  }
}
__name(parseExplicitDirectLicenseListBeforeClassifier, "parseExplicitDirectLicenseListBeforeClassifier");
function parseExplicitSkuRequestBeforeClassifier(rawText) {
  let text = String(rawText || "").trim();
  if (!text) return null;
  const skuTokenPattern = "(LIC-[A-Z0-9-]+|(?:MR|MX|MV|MG|MS|MT|CW|C9|C8|Z)\\d[\\w-]*)";
  text = text.replace(new RegExp(`\\b(\\d+)\\s*[x\xD7]\\s*${skuTokenPattern}\\b`, "gi"), (_m, qty, sku) => `${qty} ${sku}`).replace(new RegExp(`\\b${skuTokenPattern}\\s*(?:=|qty\\.?|quantity)\\s*(\\d+)\\b`, "gi"), (_m, sku, qty) => `${qty} ${sku}`).replace(new RegExp(`\\b${skuTokenPattern}\\s+[x\xD7]\\s*(\\d+)\\b`, "gi"), (_m, sku, qty) => `${qty} ${sku}`);
  const upper = text.toUpperCase().replace(/https?:\/\/\S+/g, " ");
  const skuTokens = upper.match(/\b(?:LIC-[A-Z0-9-]+|(?:MR|MX|MV|MG|MS|MT|CW|C9|C8|Z)\d[\w-]*)\b/g) || [];
  if (skuTokens.length === 0) return null;
  if (/\b(WHAT|WHICH|DIFFERENCE|COMPARE|RECOMMEND|SUPPORT|COMPATIBLE|SPEC|SPECS|DATASHEET|EOL|END\s+OF\s+LIFE|WHEN\s+DOES|HOW\s+MUCH|COST|PRICE|PRICING)\b/.test(upper)) {
    return null;
  }
  const residue = upper.replace(/\bLIC-[A-Z0-9-]+\b/g, " ").replace(/\b(?:MR|MX|MV|MG|MS|MT|CW|C9|C8|Z)\d[\w-]*\b/g, " ").replace(/\b\d+\b/g, " ").replace(/\b(QUOTE|QUOTING|CREATE|SEND|GIVE|SHOW|NEED|I|ME|PLEASE|JUST|A|AN|THE|FOR|OF|AND|OR|WITH|WITHOUT|NO|X|YEAR|YEARS|YR|YRS|Y|TERM|TERMS|ALL|HARDWARE|HW|ONLY|LICENSE|LICENCE|LICENSING|LICENSES|LICENCES|LIC|RENEWAL|RENEWALS|RENEW|SEC|SECURITY|ENT|ENTERPRISE|SDW|SD-WAN|SD|WAN|PLUS|COMMA)\b/g, " ").replace(/[,\s+*×;:(){}[\]"'`./\\-]+/g, "");
  if (residue) return null;
  try {
    const parsed = parseMessage(text);
    const hasParsedItems = parsed && Array.isArray(parsed.items) && parsed.items.length > 0;
    const hasDirectLicenseList = parsed && Array.isArray(parsed.directLicenseList) && parsed.directLicenseList.length > 0;
    const hasDirectLicense = parsed && parsed.directLicense;
    return hasParsedItems || hasDirectLicenseList || hasDirectLicense || parsed?.isClarification ? parsed : null;
  } catch (_) {
    return null;
  }
}
__name(parseExplicitSkuRequestBeforeClassifier, "parseExplicitSkuRequestBeforeClassifier");
function applyV2Revision(priorParsed, v2) {
  if (!priorParsed || !v2 || !v2.revision) return null;
  const rev = v2.revision || {};
  const mods = v2.modifiers || {};
  let action = rev.action;
  if (!action && mods.show_pricing) action = "show_pricing";
  if (!action && mods.separate_quotes) action = "toggle_separate_quotes";
  if (!action) return null;
  const hasItems = Array.isArray(priorParsed.items) && priorParsed.items.length > 0;
  const hasDirLic = priorParsed.directLicense || Array.isArray(priorParsed.directLicenseList) && priorParsed.directLicenseList.length > 0;
  if (!hasItems && !hasDirLic) return null;
  const next = {
    items: hasItems ? priorParsed.items.map((i) => ({ baseSku: i.baseSku, qty: i.qty })) : [],
    directLicense: priorParsed.directLicense ? { ...priorParsed.directLicense } : void 0,
    directLicenseList: Array.isArray(priorParsed.directLicenseList) ? priorParsed.directLicenseList.map((l) => ({ ...l })) : void 0,
    requestedTerm: priorParsed.requestedTerm ?? null,
    modifiers: { ...priorParsed.modifiers || { hardwareOnly: false, licenseOnly: false } },
    requestedTier: priorParsed.requestedTier ?? null,
    isTermOptionQuote: Boolean(priorParsed.isTermOptionQuote),
    isAdvisory: false,
    isRevision: false,
    showPricing: Boolean(mods.show_pricing) || Boolean(priorParsed.showPricing),
    unresolvedCategories: [],
    _fromV2: true,
    _revised: action
  };
  if (!next.directLicense) delete next.directLicense;
  if (!next.directLicenseList) delete next.directLicenseList;
  const stripHwSuffix = /* @__PURE__ */ __name((s) => String(s || "").toUpperCase().replace(/-(HW|MR|RTG)(-NA)?$/i, (m, _a, na) => na ? na : "").replace(/-(SEC|ENT|SDW|SD-WAN)$/i, "").trim(), "stripHwSuffix");
  switch (action) {
    case "change_term": {
      const t = parseInt(rev.new_term, 10);
      if (![1, 3, 5].includes(t)) return null;
      next.requestedTerm = t;
      if (next.isTermOptionQuote && Array.isArray(next.items) && next.items.length > 0) {
        const suffixRe = new RegExp(`-${t}Y(?:R|-S\\d+)?$`, "i");
        const filtered = next.items.filter((i) => suffixRe.test(String(i.baseSku)));
        if (filtered.length > 0) {
          next.items = filtered;
        } else {
          const rewritten = [];
          for (const it of next.items) {
            const newSku = rewriteSkuTerm(it.baseSku, t);
            if (newSku && newSku !== it.baseSku && newSku in prices) {
              rewritten.push({ ...it, baseSku: newSku });
            }
          }
          if (rewritten.length === 0) return null;
          next.items = rewritten;
        }
      }
      if (!next.isTermOptionQuote && Array.isArray(next.directLicenseList) && next.directLicenseList.length > 0) {
        const suffixRe = new RegExp(`-${t}Y(?:R|-S\\d+)?$`, "i");
        const allDuoUmb = next.directLicenseList.every((l) => /^LIC-(DUO|UMB|L-AC)-/i.test(String(l.sku || "")));
        if (allDuoUmb) {
          const filtered = next.directLicenseList.filter((l) => suffixRe.test(String(l.sku)));
          if (filtered.length > 0) {
            next.directLicenseList = filtered;
          } else {
            const rewritten = [];
            for (const lic of next.directLicenseList) {
              const newSku = rewriteSkuTerm(lic.sku, t);
              if (newSku && newSku !== lic.sku && newSku in prices) {
                rewritten.push({ ...lic, sku: newSku });
              }
            }
            if (rewritten.length === 0) return null;
            next.directLicenseList = rewritten;
          }
        }
      }
      if (next.directLicense) {
        const oldSku = String(next.directLicense.sku || "");
        const tm = oldSku.match(/-([135])(YR|Y-S\d+|Y)$/i);
        if (tm) {
          const currentTerm = parseInt(tm[1], 10);
          if (currentTerm !== t) {
            const newSku = rewriteSkuTerm(oldSku, t);
            if (newSku && newSku !== oldSku && newSku in prices) {
              next.directLicense = { ...next.directLicense, sku: newSku };
            } else {
              return null;
            }
          }
        }
      }
      return next;
    }
    case "toggle_separate_quotes": {
      next.modifiers = { ...next.modifiers || {}, separateQuotes: true };
      if (!next.isTermOptionQuote && Array.isArray(next.directLicenseList) && next.directLicenseList.length > 1) {
        const allDuoUmb = next.directLicenseList.every((l) => /^LIC-(DUO|UMB|L-AC)-/i.test(String(l.sku || "")));
        if (allDuoUmb) {
          next.items = next.directLicenseList.map((l) => ({ baseSku: l.sku, qty: l.qty }));
          delete next.directLicenseList;
          next.isTermOptionQuote = true;
        }
      }
      return next;
    }
    case "change_tier": {
      const raw = String(rev.new_tier || "").toUpperCase().replace(/\s+/g, "").replace(/^SD-WAN$/, "SDW");
      const acTier = raw === "APEX" || raw === "APX" ? "APX" : raw === "PLUS" || raw === "PLS" ? "PLS" : null;
      if (acTier) {
        const swap = /* @__PURE__ */ __name((sku) => String(sku).replace(/^LIC-L-AC-(APX|PLS)-/i, `LIC-L-AC-${acTier}-`), "swap");
        let touched = false;
        if (hasItems) {
          for (const it of next.items) {
            const newSku = swap(it.baseSku);
            if (newSku !== it.baseSku) {
              it.baseSku = newSku;
              touched = true;
            }
          }
        }
        if (next.directLicenseList) {
          for (const it of next.directLicenseList) {
            const newSku = swap(it.sku);
            if (newSku !== it.sku) {
              it.sku = newSku;
              touched = true;
            }
          }
        }
        if (next.directLicense) {
          const newSku = swap(next.directLicense.sku);
          if (newSku !== next.directLicense.sku) {
            next.directLicense.sku = newSku;
            touched = true;
          }
        }
        if (touched) {
          if (!next.isTermOptionQuote && Array.isArray(next.directLicenseList) && next.directLicenseList.length >= 2) {
            next.items = next.directLicenseList.map((l) => ({ baseSku: l.sku, qty: l.qty, isLicenseOnly: true }));
            delete next.directLicenseList;
            next.isTermOptionQuote = true;
            next.modifiers = { ...next.modifiers || {}, separateQuotes: false };
          }
          next.clarificationNote = `Swapped to AnyConnect ${acTier === "APX" ? "Apex" : "Plus"}.`;
          return next;
        }
      }
      if (!["SEC", "ENT", "SDW"].includes(raw)) return null;
      next.requestedTier = raw;
      return next;
    }
    case "toggle_hw_lic": {
      const t = rev.hw_lic_toggle;
      if (t === "hardware_only") {
        next.modifiers.hardwareOnly = true;
        next.modifiers.licenseOnly = false;
        return next;
      }
      if (t === "license_only") {
        next.modifiers.licenseOnly = true;
        next.modifiers.hardwareOnly = false;
        return next;
      }
      return null;
    }
    case "change_qty": {
      const q = parseInt(rev.new_qty, 10);
      if (!Number.isFinite(q) || q <= 0) return null;
      const tgt = rev.target_sku ? stripHwSuffix(rev.target_sku) : null;
      if (tgt && hasItems) {
        let hit = false;
        for (const it of next.items) {
          if (stripHwSuffix(it.baseSku) === tgt) {
            it.qty = q;
            hit = true;
          }
        }
        if (!hit) return null;
      } else if (hasItems) {
        for (const it of next.items) it.qty = q;
      } else if (next.directLicenseList) {
        for (const it of next.directLicenseList) it.qty = q;
      } else if (next.directLicense) {
        next.directLicense.qty = q;
      }
      return next;
    }
    case "remove": {
      const tgt = rev.target_sku ? stripHwSuffix(rev.target_sku) : null;
      if (!tgt) return null;
      if (hasItems) next.items = next.items.filter((it) => stripHwSuffix(it.baseSku) !== tgt);
      if (next.directLicenseList) next.directLicenseList = next.directLicenseList.filter((l) => String(l.sku || "").toUpperCase() !== tgt);
      if (next.directLicense && String(next.directLicense.sku).toUpperCase() === tgt) delete next.directLicense;
      if ((next.items?.length || 0) === 0 && !next.directLicense && !next.directLicenseList?.length) return null;
      return next;
    }
    case "add": {
      const adds = Array.isArray(rev.add_items) ? rev.add_items : [];
      if (adds.length === 0) return null;
      for (const a of adds) {
        if (!a || !a.sku) continue;
        const rawSku = String(a.sku).toUpperCase().trim();
        const qty = Number.isFinite(Number(a.qty)) && Number(a.qty) > 0 ? Math.floor(Number(a.qty)) : 1;
        if (rawSku.startsWith("LIC-")) {
          if (!next.directLicenseList) next.directLicenseList = next.directLicense ? [next.directLicense] : [];
          delete next.directLicense;
          next.directLicenseList.push({ sku: rawSku, qty });
        } else {
          const base = stripHwSuffix(rawSku);
          const existing = next.items.find((it) => stripHwSuffix(it.baseSku) === base);
          if (existing) existing.qty += qty;
          else next.items.push({ baseSku: base, qty });
        }
      }
      return next;
    }
    case "show_pricing": {
      next.showPricing = true;
      return next;
    }
    case "swap": {
      const tgt = rev.target_sku ? stripHwSuffix(rev.target_sku) : null;
      const adds = Array.isArray(rev.add_items) ? rev.add_items : [];
      if (!tgt || adds.length === 0) return null;
      let carriedQty = null;
      if (hasItems) {
        const targetItem = next.items.find((it) => stripHwSuffix(it.baseSku) === tgt);
        if (targetItem) carriedQty = targetItem.qty;
        next.items = next.items.filter((it) => stripHwSuffix(it.baseSku) !== tgt);
      }
      for (const a of adds) {
        if (!a || !a.sku) continue;
        const rawSku = String(a.sku).toUpperCase().trim();
        const aQty = Number.isFinite(Number(a.qty)) && Number(a.qty) > 0 ? Math.floor(Number(a.qty)) : carriedQty != null ? carriedQty : 1;
        if (rawSku.startsWith("LIC-")) {
          if (!next.directLicenseList) next.directLicenseList = next.directLicense ? [next.directLicense] : [];
          delete next.directLicense;
          next.directLicenseList.push({ sku: rawSku, qty: aQty });
        } else {
          const base = stripHwSuffix(rawSku);
          const existing = next.items.find((it) => stripHwSuffix(it.baseSku) === base);
          if (existing) existing.qty += aQty;
          else next.items.push({ baseSku: base, qty: aQty });
        }
      }
      if ((next.items?.length || 0) === 0 && !next.directLicense && !next.directLicenseList?.length) return null;
      return next;
    }
    default:
      return null;
  }
}
__name(applyV2Revision, "applyV2Revision");
var PER_TERM_STANDALONE_RE = /^LIC-MV-[135]YR$|^LIC-MT-[135]Y$|^LIC-SME-[135]YR$|^LIC-MI-EMSC-D-1YMC-A-[135]YR$|^LIC-(ENT|SEC|SDW)-[135]YR$/;
var familyKeyFromSku = /* @__PURE__ */ __name((sku) => {
  const s = String(sku || "").toUpperCase();
  if (/^LIC-MV-[135]YR$/.test(s)) return "MV";
  if (/^LIC-MT-[135]Y$/.test(s)) return "MT";
  if (/^LIC-SME-[135]YR$/.test(s)) return "SME";
  if (/^LIC-MI-EMSC-D-1YMC-A-[135]YR$/.test(s)) return "SME";
  const m = s.match(/^LIC-(ENT|SEC|SDW)-[135]YR$/);
  if (m) return m[1];
  return null;
}, "familyKeyFromSku");
function extractPriorFromAssistantUrl(content) {
  if (!content || typeof content !== "string") return null;
  const urls = content.match(/stratusinfosystems\.com\/order\/\?[^\s)`"'<>]+/gi);
  if (!urls || urls.length === 0) return null;
  const stripHw = /* @__PURE__ */ __name((s) => String(s || "").toUpperCase().replace(/-(HW|MR|RTG)(-NA)?$/i, (m, _a, na) => na ? na : "").replace(/-(SEC|ENT|SDW|SD-WAN)$/i, "").trim(), "stripHw");
  const itemMap = /* @__PURE__ */ new Map();
  const licMap = /* @__PURE__ */ new Map();
  const termsSeen = /* @__PURE__ */ new Set();
  let mxTier = null;
  let agnosticTier = null;
  for (const url of urls) {
    const qs = url.split("?")[1] || "";
    const params = {};
    for (const kv of qs.split("&")) {
      const [k, v] = kv.split("=");
      if (k) params[k] = decodeURIComponent(v || "");
    }
    const itemStr = params.item || "";
    const qtyStr = params.qty || "";
    if (!itemStr) continue;
    const skus = itemStr.split(",").map((s) => s.trim()).filter(Boolean);
    const qtys = qtyStr.split(",").map((n) => parseInt(n, 10));
    for (let i = 0; i < skus.length; i++) {
      let sku = skus[i].toUpperCase();
      const qty = Number.isFinite(qtys[i]) && qtys[i] > 0 ? qtys[i] : 1;
      if (sku.startsWith("LIC-")) {
        const smePool = sku.match(/^LIC-SME-([135])Y(R?)$/);
        if (smePool) sku = smeReplacementSku(smePool[1]);
        if (!licMap.has(sku)) licMap.set(sku, qty);
        const tm = sku.match(/-([135])Y(R?)$/);
        if (tm) termsSeen.add(parseInt(tm[1], 10));
        const mxMatch = sku.match(/^LIC-MX\w*-(SEC|ENT|SDW)-/);
        if (mxMatch) {
          mxTier = mxMatch[1];
        } else {
          const agMatch = sku.match(/^LIC-(ENT|SEC|SDW)-[135]YR?$/);
          if (agMatch) agnosticTier = agMatch[1];
        }
      } else {
        const base = stripHw(sku);
        if (base && !itemMap.has(base)) itemMap.set(base, qty);
      }
    }
  }
  const inferredTier = mxTier || agnosticTier;
  if (itemMap.size === 0 && licMap.size === 0) return null;
  const items = [];
  for (const [baseSku, qty] of itemMap) items.push({ baseSku, qty });
  const inferredTerm = termsSeen.size === 1 ? [...termsSeen][0] : null;
  if (itemMap.size > 0) {
    const agnInjections = [];
    for (const [sku, qty] of licMap) {
      if (/^LIC-(ENT|SEC|SDW)-[135]YR?$/.test(sku)) {
        agnInjections.push({ family: "MR", qty });
      } else if (/^LIC-MV-[135]YR?$/.test(sku)) {
        agnInjections.push({ family: "MV", qty });
      } else if (/^LIC-MT-[135]Y$/.test(sku)) {
        agnInjections.push({ family: "MT", qty });
      } else if (/^LIC-SME-[135]YR?$/.test(sku) || /^LIC-MI-EMSC-D-1YMC-A-[135]YR$/.test(sku)) {
        agnInjections.push({ family: "SME", qty });
      }
    }
    for (const { family, qty } of agnInjections) {
      const agnSku = `${family}-AGN`;
      const familyPresent = items.some((it) => {
        const m = it.baseSku.match(/^([A-Z]+)/);
        return m && m[1] === family;
      });
      if (!familyPresent && !items.some((it) => it.baseSku === agnSku)) {
        items.push({ baseSku: agnSku, qty });
      }
    }
  }
  if (items.length === 0 && licMap.size > 0) {
    const licList = [...licMap.entries()].map(([sku, qty]) => ({ sku, qty }));
    const isAllDuoUmb = licList.length >= 2 && licList.every((l) => /^LIC-(DUO|UMB|L-AC)-/.test(String(l.sku || "")));
    if (isAllDuoUmb) {
      const tierFamilies = /* @__PURE__ */ new Set();
      for (const l of licList) {
        tierFamilies.add(String(l.sku).replace(/-(\d)Y(?:R|-S\d+)?$/i, ""));
      }
      return {
        items: licList.map((l) => ({ baseSku: l.sku, qty: l.qty })),
        isTermOptionQuote: true,
        requestedTerm: inferredTerm,
        requestedTier: inferredTier,
        modifiers: {
          hardwareOnly: false,
          licenseOnly: true,
          separateQuotes: tierFamilies.size >= 2
        },
        isAdvisory: false,
        isRevision: false,
        showPricing: false,
        unresolvedCategories: [],
        _fromAssistantUrl: true
      };
    }
    const perTermTermsSet = /* @__PURE__ */ new Set();
    for (const l of licList) {
      const m = String(l.sku || "").toUpperCase().match(/-([135])YR?$/);
      if (m) perTermTermsSet.add(parseInt(m[1], 10));
    }
    const familyKeys = new Set(
      licList.map((l) => familyKeyFromSku(l.sku)).filter(Boolean)
    );
    const isAllPerTermStandalone = licList.length >= 2 && perTermTermsSet.size >= 2 && licList.every((l) => PER_TERM_STANDALONE_RE.test(String(l.sku || "").toUpperCase())) && familyKeys.size === 1;
    if (isAllPerTermStandalone) {
      return {
        items: licList.map((l) => ({ baseSku: l.sku, qty: l.qty, isLicenseOnly: true })),
        isTermOptionQuote: true,
        requestedTerm: inferredTerm,
        requestedTier: inferredTier,
        modifiers: { hardwareOnly: false, licenseOnly: true },
        isAdvisory: false,
        isRevision: false,
        showPricing: false,
        unresolvedCategories: [],
        _fromAssistantUrl: true
      };
    }
    if (licList.length === 1) {
      return {
        items: [],
        directLicense: licList[0],
        requestedTerm: inferredTerm,
        modifiers: { hardwareOnly: false, licenseOnly: true },
        requestedTier: inferredTier,
        isAdvisory: false,
        isRevision: false,
        showPricing: false,
        unresolvedCategories: [],
        _fromAssistantUrl: true
      };
    }
    return {
      items: [],
      directLicenseList: licList,
      requestedTerm: inferredTerm,
      modifiers: { hardwareOnly: false, licenseOnly: true },
      requestedTier: inferredTier,
      isAdvisory: false,
      isRevision: false,
      showPricing: false,
      unresolvedCategories: [],
      _fromAssistantUrl: true
    };
  }
  const hardwareOnly = licMap.size === 0;
  return {
    items,
    requestedTerm: inferredTerm,
    modifiers: { hardwareOnly, licenseOnly: false },
    requestedTier: inferredTier,
    isAdvisory: false,
    isRevision: false,
    showPricing: false,
    unresolvedCategories: [],
    _fromAssistantUrl: true
  };
}
__name(extractPriorFromAssistantUrl, "extractPriorFromAssistantUrl");
function expandFamily(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return null;
  const upper = text.toUpperCase();
  const cleaned = upper.replace(/[.!?,;:"']+$/, "").trim();
  const nonEmptyLines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (nonEmptyLines.length > 1) return null;
  if (/\bLIC-[A-Z0-9]/.test(cleaned)) return null;
  if (/\b(MS\d{2,3}-\d{1,3}[A-Z]{1,3}-\d+[GXY](?:-[A-Z]+)?|C9\d{3}L?X?-\d+[A-Z]{1,3}-\d+[GXY]-M|MR\d+[A-Z]*-HW|MX\d+[CW]{0,2}(?:-NA)?-HW(?:-NA)?|CW9\d{3}[A-Z0-9]*-(?:HW|MR|RTG))\b/.test(cleaned)) return null;
  if (/^\s*\d+\s*(MR|MV|MT)S?\s*$/.test(cleaned)) return null;
  if (/^(HOW|WHAT|WHICH|WHEN|WHERE|WHY|IS|ARE|DO|DOES|CAN|SHOULD|TELL|EXPLAIN|COMPARE|DIFFERENCE|RECOMMEND|INFO|INFORMATION|LEAD\s+TIME|NEED\s+HELP)\b/.test(cleaned)) return null;
  if (/\b(DROP|REMOVE|DELETE|REPLACE|CHANGE|REVISE)\s+(THE|THAT|IT|THOSE|THEM)\b/.test(cleaned)) return null;
  const commaParts = cleaned.split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
  if (commaParts.length > 2) return null;
  if (/\b(MX\d+[A-Z]*|MR\d+[A-Z]*|MV\d+[A-Z]*|MT\d+[A-Z]*|MG\d+[A-Z]*|Z\d+[A-Z]*|MS\d{2,3}-\d+|C9\d{3}L?X?-\d+|CW9\d{3}[A-Z]+\d*)\b/.test(cleaned)) return null;
  const wifiClass = /\b(WI[-\s]?FI\s*7|WIFI7)\b/.test(cleaned) ? "7" : /\b(WI[-\s]?FI\s*6E|WIFI6E)\b/.test(cleaned) ? "6E" : /\b(WI[-\s]?FI\s*6|WIFI6)\b/.test(cleaned) ? "6" : null;
  const hasAll = /\b(ALL|EVERY|EACH)\b/.test(cleaned);
  const FAMILY_TOKEN_RE = /\b(MS130|MS150|MS210|MS220|MS225|MS250|MS320|MS350|MS355|MS390|MS410|MS420|MS425|MS450|MS120|MS125|C9200L|C9300L|C9300X|C9300|MX|MR|MV|MT|MG|CW)S?\b/;
  const fm = cleaned.match(FAMILY_TOKEN_RE);
  let family = fm ? fm[1] : null;
  if (!family && wifiClass) {
    family = wifiClass === "6" ? "MR" : "CW";
  }
  if (!family) return null;
  let pool = Array.isArray(catalog[family]) ? catalog[family].slice() : null;
  if (!pool || pool.length === 0) return null;
  const bareFamilyRe = new RegExp(
    `^${family}S?(\\s+(APS?|ACCESS\\s+POINTS?|SWITCH(?:ES)?|APPLIANCES?|CAMERAS?|SENSORS?|GATEWAYS?|VARIANTS?|MODELS?|OPTIONS?))?$`
  );
  const isBare = cleaned === family || bareFamilyRe.test(cleaned);
  const filterWords = /\b(\d+[-\s]?PORTS?|NON[-\s]?POE|POE\+?|DATA[-\s]?ONLY|MULTIGIG|MGIG|FULL[-\s]?POE|LOW[-\s]?POE|UPOE|U[-\s]?POE|10G|25G|\b1G\b|UPLINK|NO\s+POE)\b/.test(cleaned);
  if (wifiClass && !hasAll && !filterWords && !isBare) return null;
  if (!isBare && !hasAll && !wifiClass && !filterWords) return null;
  if (wifiClass === "7") {
    pool = pool.filter((s) => /^CW917/.test(s));
  } else if (wifiClass === "6E") {
    pool = pool.filter((s) => /^CW916/.test(s));
  }
  pool = pool.filter((sku) => {
    const u = sku.toUpperCase();
    if (/^MA-/.test(u)) return false;
    if (/^(PWR|GLC|SFP|QSFP|CAB)-/.test(u)) return false;
    if (/-NM-/.test(u)) return false;
    if (/-STA-?KIT|-STAK-?KIT/.test(u)) return false;
    if (u === "CW9163E") return false;
    if (u === "CW9800H1") return false;
    if (u === "CW9179F") return false;
    return true;
  });
  const portMatch = cleaned.match(/(\d{1,3})\s*[-]?\s*PORTS?\b/);
  if (portMatch) {
    const n = portMatch[1];
    const portRe = new RegExp(`(^|[-])${n}[A-Z]{0,4}?(-|$)`);
    pool = pool.filter((s) => portRe.test(s.toUpperCase()));
  }
  const wantsNoPoe = /\b(NON[-\s]?POE|NO\s*POE|DATA[-\s]?ONLY)\b/.test(cleaned);
  const wantsFullPoe = /\b(FULL[-\s]?POE|\bFP\b)\b/.test(cleaned);
  const wantsLowPoe = /\b(LOW[-\s]?POE|\bLP\b)\b/.test(cleaned);
  const wantsMultigig = /\b(MULTIGIG|MGIG|\bMP\b)\b/.test(cleaned);
  const wantsUpoe = /\b(UPOE|U[-\s]?POE)\b/.test(cleaned);
  const wantsPoe = /\bPOE\+?\b/.test(cleaned) && !wantsNoPoe;
  if (/^(MS\d|C9)/.test(family)) {
    if (wantsNoPoe) pool = pool.filter((s) => /-\d+T(-|$)/.test(s));
    else if (wantsFullPoe) pool = pool.filter((s) => /-\d+FP(-|$)/.test(s));
    else if (wantsLowPoe) pool = pool.filter((s) => /-\d+LP(-|$)/.test(s));
    else if (wantsMultigig) pool = pool.filter((s) => /-\d+(MP|UXM|UN|PXG)(-|$)/.test(s));
    else if (wantsUpoe) pool = pool.filter((s) => /-\d+(U|UN|UX|UXM)(-|$)/.test(s));
    else if (wantsPoe) pool = pool.filter((s) => /-\d+(P|FP|LP|MP|U|UN|UX|UXM|PL|PXG)(-|$)/.test(s));
  }
  if (/\b(10G\s*UPLINK|SFP\+\s*UPLINK|TEN\s*G\s*UPLINK)\b/.test(cleaned) || /\b10G\b/.test(cleaned) && /UPLINK/.test(cleaned)) {
    if (/^(MS\d|C9)/.test(family)) pool = pool.filter((s) => /-(4X|2Y)(-M)?$/.test(s));
  } else if (/\b(1G\s*UPLINK|GIG\s*UPLINK)\b/.test(cleaned) && !/\b10G\b/.test(cleaned)) {
    if (/^(MS\d|C9)/.test(family)) pool = pool.filter((s) => /-4G(-M)?$/.test(s));
  }
  if (pool.length === 0) return null;
  pool.sort();
  const items = pool.map((baseSku) => ({ baseSku, qty: 1 }));
  return {
    items,
    requestedTerm: null,
    modifiers: { hardwareOnly: false, licenseOnly: false, separateQuotes: true },
    requestedTier: null,
    isAdvisory: false,
    isRevision: false,
    showPricing: false,
    unresolvedCategories: [],
    _fromFamilyExpansion: true,
    _familyExpandedFrom: family,
    _wifiClass: wifiClass || null
  };
}
__name(expandFamily, "expandFamily");
function assignClauseIntent(items, upper, modifiers) {
  if (!items || items.length === 0) return;
  const clauses = [];
  const sepRe = /(\s+AND\s+|\s+PLUS\s+|\s+THEN\s+|,|;|\n)/g;
  let last = 0, mm;
  while ((mm = sepRe.exec(upper)) !== null) {
    clauses.push({ start: last, end: mm.index, text: upper.slice(last, mm.index) });
    last = mm.index + mm[0].length;
  }
  clauses.push({ start: last, end: upper.length, text: upper.slice(last) });
  const HW_ONLY_RE = /\b(HARDWARE\s+ONLY|HW\s+ONLY|JUST\s+THE\s+HARDWARE|WITHOUT\s+(?:(?:A|AN|ANY|THE|\d+\s*-?\s*(?:Y|YR|YRS|YEAR|YEARS)|ENT(?:ERPRISE)?|SEC(?:URITY)?|ADV(?:ANCED)?|ESS(?:ENTIALS?)?|PLUS|AGN(?:OSTIC)?)\s+){0,4}(?:LICEN[SC]E|LISCEN[SC]E|LICESE|LICENSING)S?|(?<!\b(?:HAS|HAVE|HAD|GOT|ARE|IS|WAS|WERE)\s)NO\s+(?:(?:A|AN|ANY|THE|\d+\s*-?\s*(?:Y|YR|YRS|YEAR|YEARS)|ENT(?:ERPRISE)?|SEC(?:URITY)?|ADV(?:ANCED)?|ESS(?:ENTIALS?)?|PLUS|AGN(?:OSTIC)?)\s+){0,4}(?:LICEN[SC]E|LISCEN[SC]E|LICESE|LICENSING)S?)\b|\bHARDWARE\s*$|\bHARDWARE\s+FOR\b/;
  const LIC_RE = /\b(LICENSE[S]?|LICENCE[S]?|LISCENSE[S]?|LISCENCE[S]?|LICESE[S]?|RENEWAL[S]?|RENEW)\b/;
  const WITH_LIC_RE = /\bWITH\s+(?:(?:A|AN|ANY|THE|\d+\s*-?\s*(?:Y|YR|YRS|YEAR|YEARS)|ENT(?:ERPRISE)?|SEC(?:URITY)?|ADV(?:ANCED)?|ESS(?:ENTIALS?)?|PLUS|AGN(?:OSTIC)?)\s+){0,4}(?:LICEN[SC]E|LISCEN[SC]E|LICESE|LICENSING)S?\b/g;
  for (const c of clauses) {
    c.hardwareOnly = HW_ONLY_RE.test(c.text);
    c.licenseOnly = !c.hardwareOnly && LIC_RE.test(c.text.replace(WITH_LIC_RE, " "));
  }
  const anyExplicit = clauses.some((c) => c.hardwareOnly || c.licenseOnly);
  if (!anyExplicit) return;
  const hasHW = clauses.some((c) => c.hardwareOnly);
  const hasLic = clauses.some((c) => c.licenseOnly);
  const LIC = `(?:LICEN[SC]E|LISCEN[SC]E|LICESE)S?`;
  const leadingListLicense = new RegExp(`^\\s*(QUOTE\\s+)?(ENT(?:ERPRISE)?\\s+)?(?:${LIC}|RENEWAL[S]?|RENEW)\\b`).test(upper);
  // Ported from gchat (2026-08-19). PLURAL "… licenses" is a list modifier and
  // still covers every item. SINGULAR "… license" belongs to the item it
  // follows: "1 C8111-G2-MX and 1 Z3 license" is a licence for the Z3, and
  // widening it deleted the C8111 hardware from the cart entirely.
  const _licLastClause = clauses[clauses.length - 1] || null;
  const _licLastClauseHasItem = !!_licLastClause && items.some((it) => typeof it.position === "number" && it.position >= _licLastClause.start && it.position < _licLastClause.end);
  const _trailingLicenseMatch = upper.trim().match(/\b(?:ENT(?:ERPRISE)?\s+)?(LICEN[SC]ES?|LISCEN[SC]ES?|LICESES?|RENEWALS?)\s*$/);
  const _trailingLicensePlural = !!_trailingLicenseMatch && /S$/.test(_trailingLicenseMatch[1]);
  const trailingListLicense = !!_trailingLicenseMatch && (_trailingLicensePlural || !_licLastClauseHasItem);
  // Ported from gchat (2026-08-19). A STRONG whole-request phrase sitting before
  // the first item or after the last covers the entire list. Without it,
  // "quote 2 MX67C and 4 MR44 hardware only" left the MX67C licensed and shipped
  // a licence the request had explicitly declined. Between two items it stays
  // attached to its own clause, so mid-list phrasing is unchanged.
  const STRONG_HW_ONLY_RE = /\b(?:HARDWARE\s+ONLY|HW\s+ONLY|JUST\s+THE\s+HARDWARE|(?:NO|WITHOUT)\s+(?:LICEN[SC]E|LISCEN[SC]E|LICESE|LICENSING)S?)\b/;
  const STRONG_LIC_ONLY_RE = /\b(?:(?:LICEN[SC]E|LISCEN[SC]E|LICESE)S?\s+ONLY|LICENSING\s+ONLY|(?:NO|WITHOUT)\s+HARDWARE)\b/;
  const _itemPositions = items.map((it) => it.position).filter((n) => typeof n === "number");
  const _lastItemPos = _itemPositions.length ? Math.max(..._itemPositions) : -1;
  const _firstItemPos = _itemPositions.length ? Math.min(..._itemPositions) : -1;
  const strongPhraseOutsideItemList = (re) => {
    const m = String(upper).match(re);
    if (!m || _lastItemPos < 0) return false;
    return m.index > _lastItemPos || m.index < _firstItemPos;
  };
  const trailingListHardwareOnly = strongPhraseOutsideItemList(STRONG_HW_ONLY_RE);
  const trailingListLicenseOnly = strongPhraseOutsideItemList(STRONG_LIC_ONLY_RE);
  const inheritGlobalLicense = hasLic && !hasHW && (leadingListLicense || trailingListLicense || trailingListLicenseOnly);
  const leadingListHardware = /^\s*(QUOTE\s+)?(HARDWARE\s+ONLY\s+FOR|HARDWARE\s+FOR|HW\s+FOR)\b/.test(upper);
  const _lastClause = clauses[clauses.length - 1];
  const _lastClauseHasItem = items.some((it) => typeof it.position === "number" && it.position >= _lastClause.start && it.position < _lastClause.end);
  const trailingBareHardware = _lastClause.hardwareOnly && !_lastClauseHasItem;
  const inheritGlobalHardware = hasHW && !hasLic && (leadingListHardware || trailingBareHardware || trailingListHardwareOnly);
  const clauseFor = /* @__PURE__ */ __name((pos) => {
    if (typeof pos !== "number") return null;
    for (const c of clauses) {
      if (pos >= c.start && pos < c.end) return c;
    }
    return null;
  }, "clauseFor");
  for (const item of items) {
    const c = clauseFor(item.position);
    if (c && c.hardwareOnly) {
      item.hardwareOnly = true;
      item.licenseOnly = false;
    } else if (c && c.licenseOnly) {
      item.hardwareOnly = false;
      item.licenseOnly = true;
    } else if (inheritGlobalLicense || inheritGlobalHardware) {
      if (inheritGlobalHardware) {
        item.hardwareOnly = true;
        item.licenseOnly = false;
      } else {
        item.hardwareOnly = modifiers.hardwareOnly;
        item.licenseOnly = modifiers.licenseOnly;
      }
    } else {
      item.hardwareOnly = false;
      item.licenseOnly = false;
    }
  }
}
__name(assignClauseIntent, "assignClauseIntent");
function parseMessage(text) {
  text = convertWordNumbers(text);
  const _expandedFamily = expandFamily(text);
  if (_expandedFamily && _expandedFamily.items && _expandedFamily.items.length > 0) {
    const _upper = text.toUpperCase();
    const _LIC_WORD = `(?:LICENSE|LICENCE|LISCENSE|LISCENCE|LICESE|LIC)`;
    const _LIC_WORDS = `(?:LICENSE[S]?|LICENCE[S]?|LISCENSE[S]?|LISCENCE[S]?|LICESE[S]?|LIC)`;
    const _hwOnlyRe = /\b(HARDWARE\s+ONLY|WITHOUT\s+(?:(?:A|AN|ANY|THE|\d+\s*-?\s*(?:Y|YR|YRS|YEAR|YEARS)|ENT(?:ERPRISE)?|SEC(?:URITY)?|ADV(?:ANCED)?|ESS(?:ENTIALS?)?|PLUS|AGN(?:OSTIC)?)\s+){0,4}(?:LICEN[SC]E|LISCEN[SC]E|LICESE|LICENSING)S?|(?<!\b(?:HAS|HAVE|HAD|GOT|ARE|IS|WAS|WERE)\s)NO\s+(?:(?:A|AN|ANY|THE|\d+\s*-?\s*(?:Y|YR|YRS|YEAR|YEARS)|ENT(?:ERPRISE)?|SEC(?:URITY)?|ADV(?:ANCED)?|ESS(?:ENTIALS?)?|PLUS|AGN(?:OSTIC)?)\s+){0,4}(?:LICEN[SC]E|LISCEN[SC]E|LICESE|LICENSING)S?|JUST\s+THE\s+HARDWARE|HW\s+ONLY)\b/;
    const _hwExcl = /\b(HARDWARE\s+(SPECS?|INFO|DETAILS?|QUESTION|ISSUE|PROBLEM|SUPPORT|FAILURE|WARRANTY))\b/;
    const _licOnlyRe = new RegExp(`\\b(${_LIC_WORDS}\\s+ONLY|JUST\\s+THE\\s+${_LIC_WORD}|JUST\\s+${_LIC_WORD}|NO\\s+HARDWARE|RENEWAL\\s+ONLY|${_LIC_WORD}\\s+RENEWAL|RENEW\\s+(THE\\s+)?${_LIC_WORDS})\\b`);
    if (_hwOnlyRe.test(_upper) && !_hwExcl.test(_upper)) {
      _expandedFamily.modifiers.hardwareOnly = true;
      _expandedFamily.modifiers.licenseOnly = false;
    } else if (_licOnlyRe.test(_upper)) {
      _expandedFamily.modifiers.licenseOnly = true;
      _expandedFamily.modifiers.hardwareOnly = false;
    }
    return _expandedFamily;
  }
  const upper = text.toUpperCase();
  const SEPARATE_QUOTES_RE = /\b(SEPARATE\s+(QUOTES?|URLS?|LINKS?)|INDIVIDUAL\s+(QUOTES?|URLS?|LINKS?)|EACH\s+(AS\s+)?(ITS\s+)?OWN\s+(QUOTES?|URLS?|LINKS?)|ONE\s+(QUOTE|URL|LINK)\s+(PER|EACH|APIECE|FOR\s+EACH)|BREAK\s+(THESE|THEM|IT)\s+OUT|SPLIT\s+(INTO|UP\s+INTO)\s+SEPARATE|AS\s+(THEIR|ITS)\s+OWN\s+(QUOTES?|URLS?|LINKS?))\b/;
  let __separateQuotes = SEPARATE_QUOTES_RE.test(upper);
  const rawLines = text.trim().split(/[\n\r]+/).map((l) => l.trim()).filter(Boolean);
  const lines = rawLines.map((l) => l.replace(/^[\s•\-\*·▸▹►‣⁃◦]+\s*/, "").replace(/^\d+[.)]\s*/, "").trim()).filter(Boolean);
  if (lines.length >= 2) {
    const licItems = [];
    for (const line of lines) {
      const csvMatch = line.match(/^\s*(LIC-[A-Z0-9-]+)\s*[,\s]\s*(\d+)\s*$/i);
      const qtyFirstMatch = !csvMatch && line.match(/^\s*(\d+)\s*[xX×]?\s*(LIC-[A-Z0-9-]+)\s*$/i);
      const skuXqtyMatch = !csvMatch && !qtyFirstMatch && line.match(/^\s*(LIC-[A-Z0-9-]+)\s*[xX×]\s*(\d+)\s*$/i);
      if (csvMatch) {
        licItems.push({ sku: csvMatch[1].toUpperCase(), qty: parseInt(csvMatch[2]) });
      } else if (qtyFirstMatch) {
        licItems.push({ sku: qtyFirstMatch[2].toUpperCase(), qty: parseInt(qtyFirstMatch[1]) });
      } else if (skuXqtyMatch) {
        licItems.push({ sku: skuXqtyMatch[1].toUpperCase(), qty: parseInt(skuXqtyMatch[2]) });
      } else {
        const singleMatch = line.match(/^\s*(LIC-[A-Z0-9-]+)\s*$/i);
        if (singleMatch) {
          licItems.push({ sku: singleMatch[1].toUpperCase(), qty: 1 });
        }
      }
    }
    const seenSkus = /* @__PURE__ */ new Set();
    const dedupedItems = [];
    for (const item of licItems) {
      if (!seenSkus.has(item.sku)) {
        seenSkus.add(item.sku);
        dedupedItems.push(item);
      }
    }
    if (dedupedItems.length >= 2) {
      return {
        items: [],
        directLicenseList: dedupedItems,
        requestedTerm: null,
        modifiers: { hardwareOnly: false, licenseOnly: true },
        requestedTier: null,
        isAdvisory: false,
        isRevision: false,
        showPricing: false
      };
    }
  }
  if (lines.length <= 2) {
    const commaParts = text.split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
    const licFromComma = [];
    for (const part of commaParts) {
      const m1 = part.match(/^\s*(LIC-[A-Z0-9-]+)\s*$/i);
      const m2 = part.match(/^\s*(LIC-[A-Z0-9-]+)\s+(\d+)\s*$/i);
      const m3 = part.match(/^\s*(\d+)\s*[xX×]?\s*(LIC-[A-Z0-9-]+)\s*$/i);
      const m4 = part.match(/^\s*(LIC-[A-Z0-9-]+)\s*[xX×]\s*(\d+)\s*$/i);
      if (m2) {
        licFromComma.push({ sku: m2[1].toUpperCase(), qty: parseInt(m2[2]) });
      } else if (m3) {
        licFromComma.push({ sku: m3[2].toUpperCase(), qty: parseInt(m3[1]) });
      } else if (m4) {
        licFromComma.push({ sku: m4[1].toUpperCase(), qty: parseInt(m4[2]) });
      } else if (m1) {
        licFromComma.push({ sku: m1[1].toUpperCase(), qty: 1 });
      }
    }
    if (licFromComma.length >= 2) {
      const seenC = /* @__PURE__ */ new Set();
      const dedupC = [];
      for (const item of licFromComma) {
        if (!seenC.has(item.sku)) {
          seenC.add(item.sku);
          dedupC.push(item);
        }
      }
      return {
        items: [],
        directLicenseList: dedupC,
        requestedTerm: null,
        modifiers: { hardwareOnly: false, licenseOnly: true },
        requestedTier: null,
        isAdvisory: false,
        isRevision: false,
        showPricing: false
      };
    }
  }
  const embeddedLicItems = extractEmbeddedDirectLicenseList(text);
  if (embeddedLicItems) {
    return {
      items: [],
      directLicenseList: embeddedLicItems,
      requestedTerm: null,
      modifiers: { hardwareOnly: false, licenseOnly: true },
      requestedTier: null,
      isAdvisory: false,
      isRevision: false,
      showPricing: false
    };
  }
  if (lines.length >= 3) {
    const modelPattern = /^\s*((?:MR|MV|MT|MG|MX|CW9|MS|C9|C8|Z)\d[A-Z0-9-]*)\s*$/i;
    const modelLines = lines.filter((l) => modelPattern.test(l));
    if (modelLines.length >= 3 && modelLines.length / lines.length >= 0.7) {
      const counts = /* @__PURE__ */ new Map();
      for (const line of modelLines) {
        const m = line.match(modelPattern);
        if (m) {
          const sku = m[1].toUpperCase();
          counts.set(sku, (counts.get(sku) || 0) + 1);
        }
      }
      const items2 = [...counts.entries()].map(([baseSku, qty]) => ({ baseSku, qty }));
      const nonModelLines = lines.filter((l) => !modelPattern.test(l)).join(" ").toUpperCase();
      const isLicenseOnly = /\b(LICENSE|LICENCE|LISCENSE|LISCENCE|RENEWAL|RENEW|LIC)\b/.test(nonModelLines);
      const showPricing2 = /\b(HOW\s+MUCH|PRICE[SD]?|PRICING|COST[S]?)\b/.test(nonModelLines);
      return {
        items: items2,
        requestedTerm: null,
        modifiers: { hardwareOnly: false, licenseOnly: isLicenseOnly },
        requestedTier: null,
        isAdvisory: false,
        isRevision: false,
        showPricing: showPricing2
      };
    }
  }
  {
    const PREAMBLE_RE = /^\s*(?:PLEASE\s+|JUST\s+|ONLY\s+)?(?:CAN\s+YOU\s+|COULD\s+YOU\s+)?(?:PRICING\s+(?:ON|FOR)|PRICE\s+(?:OF|FOR)|COST\s+(?:OF|FOR)|HOW\s+MUCH\s+(?:IS|ARE|FOR)|I\s+(?:NEED|WANT)|GIVE\s+ME|SEND\s+ME|GET\s+ME|QUOTE\s+ME|QUOTE|PRICING|PRICE|COST|GET|NEED|WANT|FOR|ON|PLEASE|JUST|ONLY)\s+/i;
    const TRAILER_RE = /\s+(?:LICENSES?|LICENCES?|LISCENSES?|LISCENCES?|LIC|RENEWALS?|OF\s+(?:THEM|THESE|THOSE)|ONLY|PLEASE|THANKS?|THANK\s+YOU)\s*$/i;
    const TERM_PREFIX_RE = /^\s*(?:(?:JUST|ONLY)\s+(?:THE\s+)?)?(?:A\s+)?[135]\s*-?\s*(?:Y|YR|YRS|YEAR|YEARS)(?:\s+(?:TERM\s+)?ONLY)?\s+/i;
    const TERM_TRAILER_RE = /\s+(?:(?:JUST|ONLY)\s+(?:THE\s+)?)?(?:A\s+)?[135]\s*-?\s*(?:Y|YR|YRS|YEAR|YEARS)(?:\s+(?:TERM\s+)?ONLY)?\s*$/i;
    let stripped = upper.replace(/\s+(?:QTY|QUANTITY)\s+(\d+)\s*$/i, " $1").trim();
    for (let i = 0; i < 4; i++) {
      const before = stripped;
      stripped = stripped.replace(PREAMBLE_RE, "").replace(TRAILER_RE, "").replace(TERM_PREFIX_RE, "").replace(TERM_TRAILER_RE, "").trim();
      if (stripped === before) break;
    }
    const qtyFirst = stripped.match(/^(\d+)\s*[X×]?\s*(LIC-[A-Z0-9-]+)\s*$/);
    const skuFirst = !qtyFirst && stripped.match(/^(LIC-[A-Z0-9-]+?)(?:\s*[X×]\s*|\s+)(\d+)\s*$/);
    const skuOnly = !qtyFirst && !skuFirst && stripped.match(/^(LIC-[A-Z0-9-]+)\s*$/);
    let licSku = null, qty = 1;
    if (qtyFirst) {
      qty = parseInt(qtyFirst[1]);
      licSku = qtyFirst[2];
    } else if (skuFirst) {
      licSku = skuFirst[1];
      qty = parseInt(skuFirst[2]);
    } else if (skuOnly) {
      licSku = skuOnly[1];
      qty = 1;
    }
    if (licSku && licSku.startsWith("LIC-")) {
      let _smeNote = null;
      const _smeDirect = licSku.match(/^LIC-SME-(\d+)Y(R)?$/i);
      if (_smeDirect) {
        licSku = smeReplacementSku(_smeDirect[1]);
        _smeNote = SME_EOL_FLAG;
      }
      const _directLicenseItem = { sku: licSku, qty };
      if (!shouldPreserveTypedDirectLicenseTerm(text, licSku) && canRewriteDirectLicenseListForAllTerms([_directLicenseItem])) {
        return {
          items: [],
          directLicenseList: [_directLicenseItem],
          requestedTerm: null,
          modifiers: { hardwareOnly: false, licenseOnly: true },
          requestedTier: null,
          isAdvisory: false,
          isRevision: false,
          showPricing: false,
          clarificationNote: _smeNote || void 0
        };
      }
      return {
        items: [],
        directLicense: _directLicenseItem,
        requestedTerm: null,
        modifiers: { hardwareOnly: false, licenseOnly: true },
        requestedTier: null,
        isAdvisory: false,
        isRevision: false,
        showPricing: false,
        clarificationNote: _smeNote || void 0
      };
    }
  }
  let requestedTerm = null;
  const TERM_RE = /(?<![\w-])([135])\s*-?\s*Y(?:R|EAR|EARS)?\b/i;
  const tm = upper.match(TERM_RE);
  if (tm) requestedTerm = parseInt(tm[1]);
  const modifiers = { hardwareOnly: false, licenseOnly: false };
  if (/\b(HARDWARE\s+ONLY|HARDWARE|WITHOUT\s+(A\s+)?(?:LICENSE|LICENCE|LISCENSE|LISCENCE)|NO\s+(?:LICENSE|LICENCE|LISCENSE|LISCENCE)|JUST\s+THE\s+HARDWARE|HW\s+ONLY)\b/.test(upper) && !/\b(HARDWARE\s+(SPECS?|INFO|DETAILS?|QUESTION|ISSUE|PROBLEM|SUPPORT|FAILURE|WARRANTY))\b/.test(upper)) {
    modifiers.hardwareOnly = true;
  }
  const LIC_WORD = `(?:LICENSE|LICENCE|LISCENSE|LISCENCE|LICESE|LIC)`;
  const LIC_WORDS = `(?:LICENSE[S]?|LICENCE[S]?|LISCENSE[S]?|LISCENCE[S]?|LICESE[S]?|LIC)`;
  const licOnlyRe = new RegExp(`\\b(${LIC_WORDS}\\s+ONLY|JUST\\s+THE\\s+${LIC_WORD}|JUST\\s+${LIC_WORD}|${LIC_WORDS}\\s+ONLY|NO\\s+HARDWARE|RENEWAL\\s+ONLY|${LIC_WORD}\\s+RENEWAL|RENEW\\s+(THE\\s+)?${LIC_WORDS}|RENEWAL\\s+FOR|RENEW\\s+EXISTING)\\b`);
  if (licOnlyRe.test(upper)) {
    modifiers.licenseOnly = true;
  }
  if (!modifiers.licenseOnly) {
    const licForSkuRe = new RegExp(`\\b(${LIC_WORDS}\\s+FOR\\s+(AN?\\s+)?(\\d+\\s*)?(MR|MS|MX|MV|MT|MG|CW|Z)(\\d|'?S?\\b)|RENEWAL[S]?\\s+(OF\\s+|FOR\\s+)?(\\d+\\s*)?(MR|MS|MX|MV|MT|MG|CW|Z)(\\d|'?S?\\b))`);
    if (licForSkuRe.test(upper)) modifiers.licenseOnly = true;
  }
  if (!modifiers.licenseOnly) {
    const skuLicRe = new RegExp(`^(QUOTE\\s+)?(\\d+\\s+)?(MR|MS|MX|MV|MT|MG|CW|Z)\\d*[A-Z0-9-]*\\s+(${LIC_WORDS}|RENEWAL[S]?)\\s*$`, "i");
    if (skuLicRe.test(upper.trim()) && !/\bWITH\b/.test(upper)) modifiers.licenseOnly = true;
  }
  if (!modifiers.licenseOnly && /^\s*(QUOTE\s+)?RENEWAL\s+(FOR\s+)?\d/i.test(upper)) {
    modifiers.licenseOnly = true;
  }
  if (!modifiers.licenseOnly && !/\bWITH\b/.test(upper)) {
    const trailingLicRe = new RegExp(`\\b(ENT(?:ERPRISE)?\\s+)?${LIC_WORDS}\\s*$`);
    if (trailingLicRe.test(upper.trim())) modifiers.licenseOnly = true;
  }
  const showPricing = /\b(HOW\s+MUCH|PRICE[SD]?|PRICING|COST[S]?|WITH\s+PRIC(E|ING|ES))\b/.test(upper);
  modifiers.separateQuotes = __separateQuotes;
  let requestedTier = null;
  if (hasMsAdvancedTierIntent(upper)) {
    requestedTier = "A";
  } else if (/\b(ADVANCED\s+SECURITY|SEC(URITY)?)\b/.test(upper) && !/\bENTERPRISE\b/.test(upper)) {
    requestedTier = "SEC";
  } else if (/\bENT(ERPRISE)?\b/.test(upper) && !/\bSEC(URITY)?\b/.test(upper)) {
    requestedTier = "ENT";
  } else if (/\b(SD[\s-]?WAN|SDW)\b/.test(upper)) {
    requestedTier = "SDW";
  }
  const advisoryPatterns = [
    /\bWHAT('?S| IS) THE DIFFERENCE\b/,
    /\bWHICH (ONE |SHOULD |DO |WOULD )/,
    /\bDO I NEED\b/,
    /\bIS .+ COMPATIBLE\b/,
    /\bCAN I USE\b/,
    /\bSHOULD I (GET|USE|GO|CHOOSE|PICK)\b/,
    /\bWHAT (DO YOU|WOULD YOU) (RECOMMEND|SUGGEST)\b/,
    /\bCOMPARE\b/,
    /\bTELL ME ABOUT\b/,
    /\bWHAT('?S| IS) THE BEST\b/,
    /\bHOW (DOES|DO|MANY|MUCH THROUGHPUT|FAST)\b/,
    /\bSPECS?\b/,
    /\bDIFFERENCE BETWEEN\b/,
    // Product info / support / feature questions (should NOT generate quotes)
    /\bDOES .+ SUPPORT\b/,
    /\bIS .+ SUPPORTED\b/,
    /\bIS .+ (STILL )?AVAILABLE\b/,
    /\bWHAT .+ SUPPORT\b/,
    /\bWHAT (POE|UPLINK|PORT|SPEED|THROUGHPUT|BANDWIDTH|FEATURE)/,
    /\bDOES .+ (HAVE|INCLUDE|COME WITH|OFFER)\b/,
    /\bIS .+ (EOL|END OF LIFE|DISCONTINUED|DEPRECATED|STILL SOLD)\b/,
    /\bCAN .+ (HANDLE|SUPPORT|DO)\b/,
    /\bWHAT('?S| IS|'S) .+ (CAPABLE|RATED|MAX|MAXIMUM)\b/,
    /\bWRITE .+ PROPOSAL\b/,
    /\bDRAFT .+ PROPOSAL\b/,
    /\bBUILD .+ PROPOSAL\b/,
    // Accessory/connectivity intent patterns (Phase 2)
    /\bWHAT SFP\b/,
    /\bWHICH SFP\b/,
    /\bWHAT OPTIC\b/,
    /\bWHICH OPTIC\b/,
    /\bCONNECT .+ TO\b/,
    /\bLINK .+ TO\b/,
    /\bHOOK UP\b/,
    /\bWHAT (CABLE|STACKING|STACK)\b/,
    /\bSTACK(ING|ABLE)? (CABLE)?\b/,
    /\bIS .+ STACKABLE\b/,
    /\bCAN .+ (BE )?STACK(ED)?\b/,
    /\bUPLINK MODULE\b/,
    /\bWHAT MODULE\b/,
    /\bWHICH MODULE\b/,
    /\bFIBER (TYPE|OPTIC|CABLE)\b/,
    /\bDAC\b/,
    /\bTWINAX\b/,
    /\bSFP.{0,20}(NEED|REQUIRE|USE|COMPATIBLE)\b/,
    /\bCOMPATIBLE (SFP|OPTIC|MODULE|TRANSCEIVER)\b/,
    /\bHOW (DO I |TO )?(CONNECT|LINK|UPLINK)\b/
  ];
  const isAdvisory = advisoryPatterns.some((p) => p.test(upper));
  const isDuo = /\b(?:DUO|CISCO\s*DUO)\b/i.test(upper);
  if (isDuo && !isAdvisory) {
    const duoTiers = [];
    const tierOrderRe = /\b(ADVANTAGE|PREMIER|ESSENTIAL(?:S)?)\b/gi;
    let tm2;
    while ((tm2 = tierOrderRe.exec(upper)) !== null) {
      const raw = tm2[1].toUpperCase();
      const canon = raw === "ADVANTAGE" ? "ADVANTAGE" : raw === "PREMIER" ? "PREMIER" : "ESSENTIALS";
      if (!duoTiers.includes(canon)) duoTiers.push(canon);
    }
    const isAllDuo = /\bALL\s+(?:CISCO\s+)?DUO\b/i.test(upper);
    if (isAllDuo && duoTiers.length === 0) {
      duoTiers.push("ESSENTIALS", "ADVANTAGE", "PREMIER");
      __separateQuotes = true;
    }
    const duoQtyMatch = upper.match(/\b(\d+)\b/);
    const duoQty = duoQtyMatch ? parseInt(duoQtyMatch[1]) : 1;
    if (duoTiers.length === 0) {
      return {
        items: [],
        isQuote: false,
        isClarification: true,
        clarificationMessage: `Which Cisco Duo tier do you need? (qty: ${duoQty})

\u2022 **Essentials** \u2014 MFA, passwordless, device trust
\u2022 **Advantage** \u2014 Essentials + adaptive policies, VPN-less remote access
\u2022 **Premier** \u2014 Advantage + full SSO, Duo Trust Monitor

Just reply with the tier name (e.g. "Duo Advantage") or "Duo Essentials ${duoQty}".`
      };
    }
    const duoItems = [];
    for (const tier of duoTiers) {
      for (const t of [1, 3, 5]) {
        duoItems.push({ baseSku: `LIC-DUO-${tier}-${t}YR`, qty: duoQty, isLicenseOnly: true });
      }
    }
    let duoFinalItems = duoItems;
    if (requestedTerm) {
      duoFinalItems = duoItems.filter((it) => it.baseSku.endsWith(`-${requestedTerm}YR`));
    }
    return {
      items: duoFinalItems,
      isQuote: true,
      isTermOptionQuote: true,
      modifiers: { separateQuotes: __separateQuotes || duoTiers.length > 1 }
    };
  }
  const umbTypeTierAdjacent = /\b(?:DNS|SIG|SECURE\s+INTERNET\s+GATEWAY)[\s-]+(?:ESSENTIALS?|ADVANTAGE)\b/i.test(upper);
  const umbQtyTypeAdjacent = /\b\d+\s*[X×]?\s*(?:DNS|SIG)\b(?!\s+(?:SERVERS?|RECORDS?|SETTINGS?|ENTRIES|ENTRY|QUERIES|QUERY|REQUESTS?|LOOKUPS?|NAMES?|ZONES?|RESOLVERS?|ISSUES?|PROBLEMS?|ERRORS?|TRAFFIC))/i.test(upper);
  const isUmb = /\b(?:UMBRELLA|UMB)\b/i.test(upper) || umbTypeTierAdjacent || umbQtyTypeAdjacent;
  if (isUmb && !isAdvisory) {
    const umbTypes = [];
    const typeRe = /\b(DNS|SIG)\b/gi;
    let tym;
    while ((tym = typeRe.exec(upper)) !== null) {
      const canon = tym[1].toUpperCase();
      if (!umbTypes.includes(canon)) umbTypes.push(canon);
    }
    if (!umbTypes.includes("SIG") && /\bSECURE\s+INTERNET\s+GATEWAY\b/i.test(upper)) umbTypes.push("SIG");
    const umbTiers = [];
    const tierRe = /\b(ADV(?:ANTAGE|ANCED)?|ESS(?:ENTIALS?)?)\b/gi;
    let trm;
    while ((trm = tierRe.exec(upper)) !== null) {
      const raw = trm[1].toUpperCase();
      const canon = raw.startsWith("ADV") ? "ADV" : "ESS";
      if (!umbTiers.includes(canon)) umbTiers.push(canon);
    }
    const umbQtyMatch = upper.match(/\b(\d+)\b/);
    const umbQty = umbQtyMatch ? parseInt(umbQtyMatch[1]) : 1;
    const umbTermMatch = upper.match(/\b([135])\s*(?:YR|YEAR|YEARS)\b/);
    const umbRequestedTerm = umbTermMatch ? parseInt(umbTermMatch[1]) : null;
    if (umbTypes.length === 0 || umbTiers.length === 0) {
      const umbKnownType = umbTypes.length === 1 ? umbTypes[0] : null;
      let prompt = `Which Umbrella package do you need? (qty: ${umbQty}${umbKnownType ? `, type: ${umbKnownType}` : ""})

`;
      if (umbTypes.length === 0) {
        prompt += `**Type:**
\u2022 **DNS Security** \u2014 DNS-layer protection
\u2022 **SIG** (Secure Internet Gateway) \u2014 full web proxy + DNS

`;
      }
      if (umbTiers.length === 0) {
        prompt += `**Tier:**
\u2022 **Essentials** \u2014 core protection
\u2022 **Advantage** \u2014 Essentials + advanced features

`;
      }
      prompt += umbKnownType ? `Reply with the tier, e.g. "Essentials" or "${umbKnownType} Advantage".` : `Reply with the full package, e.g. "Umbrella DNS Essentials ${umbQty}" or "Umbrella SIG Advantage".`;
      return {
        items: [],
        isQuote: false,
        isClarification: true,
        clarificationMessage: prompt
      };
    }
    const umbItems = [];
    for (const type of umbTypes) {
      for (const tier of umbTiers) {
        for (const t of [1, 3, 5]) {
          umbItems.push({ baseSku: `LIC-UMB-${type}-${tier}-K9-${t}YR`, qty: umbQty, isLicenseOnly: true });
        }
      }
    }
    const combos = umbTypes.length * umbTiers.length;
    let umbFinalItems = umbItems;
    if (umbRequestedTerm) {
      umbFinalItems = umbItems.filter((it) => it.baseSku.endsWith(`-${umbRequestedTerm}YR`));
    }
    return {
      items: umbFinalItems,
      isQuote: true,
      isTermOptionQuote: true,
      modifiers: { separateQuotes: __separateQuotes || combos > 1 }
    };
  }
  const isAnyConnect = /\b(ANY\s*CONNECT|ANYCONNECT|CISCO\s+SECURE\s+CLIENT|SECURE\s+CLIENT|CISCO\s+VPN)\b/i.test(upper);
  if (isAnyConnect && !isAdvisory) {
    const acTiers = [];
    const acTierRe = /\b(APEX|APX|PLUS|PLS)\b/gi;
    let atm;
    while ((atm = acTierRe.exec(upper)) !== null) {
      const raw = atm[1].toUpperCase();
      const canon = raw === "APEX" || raw === "APX" ? "APX" : "PLS";
      if (!acTiers.includes(canon)) acTiers.push(canon);
    }
    if (acTiers.length === 0) {
      acTiers.push("APX", "PLS");
      __separateQuotes = true;
    }
    const acQtyMatch = [...upper.matchAll(/\b(\d+)\b/g)].find((m) => {
      const after = upper.slice(m.index + m[0].length, m.index + m[0].length + 15);
      return !/^\s*-?\s*(?:Y|YR|YEAR|YEARS)\b/i.test(after);
    });
    let acQty = acQtyMatch ? parseInt(acQtyMatch[1]) : 25;
    let acQtyClamped = false;
    if (acQty < 25) {
      acQty = 25;
      acQtyClamped = true;
    }
    const acItems = [];
    for (const tier of acTiers) {
      for (const t of [1, 3, 5]) {
        acItems.push({ baseSku: `LIC-L-AC-${tier}-${t}Y-S1`, qty: acQty, isLicenseOnly: true });
      }
    }
    let acFinalItems = acItems;
    if (requestedTerm) {
      acFinalItems = acItems.filter((it) => it.baseSku.endsWith(`-${requestedTerm}Y-S1`));
    }
    const result = {
      items: acFinalItems,
      isQuote: true,
      isTermOptionQuote: true,
      modifiers: { separateQuotes: __separateQuotes || acTiers.length > 1 }
    };
    if (acQtyClamped) {
      result.clarificationNote = `AnyConnect has a 25-user minimum \u2014 bumped quantity to 25.`;
    }
    return result;
  }
  const smeBareMention = findBareSmeMention(upper);
  const smeMentioned = Boolean(smeBareMention);
  const smeNamedTermIntent = /\b\d+\s*-?\s*(?:YRS?|YEARS?|Y)\b/i.test(upper);
  const smeQuoteContext = smeNamedTermIntent || /\b(LICEN[SC]ES?|LISCEN[SC]ES?|RENEWALS?|RENEW|QUOTES?|QUOTING|PRICE|PRICES|PRICING)\b/i.test(upper);
  const smeInfoQuestion = /\b(WHAT\s+IS|WHAT\s+ARE|WHAT'?S|TELL\s+ME\s+ABOUT|EXPLAIN|DESCRIBE|HOW\s+(?:DO|DOES|DO\s+I)|DEFINE)\b/i.test(upper);
  const smeExplicitQuoteVerb = /\b(QUOTE|QUOTES|QUOTING|PRICE|PRICES|PRICING|COST|COSTS|RENEW|RENEWAL|RENEWALS|BUY|PURCHASE|ORDER)\b/i.test(upper);
  if (smeMentioned && smeQuoteContext && !hasOtherQuoteSkuForSme(upper) && !isAdvisory && (!smeInfoQuestion || smeExplicitQuoteVerb)) {
    const smeQty = smeBareMention.qty;
    const smeTermMatch = upper.match(/\b(\d+)\s*-?\s*(?:YRS?|YEARS?|Y)\b/);
    if (smeTermMatch) {
      return {
        items: [],
        directLicense: { sku: smeReplacementSku(smeTermMatch[1]), qty: smeQty },
        clarificationNote: SME_EOL_FLAG,
        requestedTerm: null,
        modifiers: { hardwareOnly: false, licenseOnly: true, separateQuotes: false },
        requestedTier: null,
        isAdvisory: false,
        isRevision: false,
        showPricing: false,
        unresolvedCategories: []
      };
    }
    const smeItems = ["1", "3", "5"].map((t) => ({ baseSku: `${SME_REPLACEMENT_BASE}-${t}YR`, qty: smeQty, isLicenseOnly: true }));
    return {
      items: smeItems,
      isQuote: true,
      isTermOptionQuote: true,
      modifiers: { hardwareOnly: false, licenseOnly: true, separateQuotes: false },
      clarificationNote: SME_EOL_FLAG,
      unresolvedCategories: []
    };
  }
  const AGNOSTIC_FAMILY = `(MR|MV|MT)(?:'?S)?`;
  let agnosticFamily = null;
  let agnosticQty = 1;
  let _m;
  _m = upper.match(new RegExp(`(\\d+)\\s*[X\xD7]?\\s*${AGNOSTIC_FAMILY}\\s+(${LIC_WORDS}|RENEWAL)S?`, "i"));
  if (_m) {
    agnosticQty = parseInt(_m[1]);
    agnosticFamily = _m[2].toUpperCase();
  }
  if (!agnosticFamily) {
    _m = upper.trim().match(new RegExp(`^(?:QUOTE\\s+)?${AGNOSTIC_FAMILY}\\s+(${LIC_WORDS}|RENEWAL)S?\\s*$`, "i"));
    if (_m) {
      agnosticFamily = _m[1].toUpperCase();
    }
  }
  if (!agnosticFamily) {
    _m = upper.match(new RegExp(`${AGNOSTIC_FAMILY}\\s+(${LIC_WORDS}|RENEWAL)S?\\s*[X\xD7]?\\s*(\\d+)`, "i"));
    if (_m) {
      agnosticFamily = _m[1].toUpperCase();
      agnosticQty = parseInt(_m[3]);
    }
  }
  if (!agnosticFamily) {
    _m = upper.trim().match(new RegExp(`^(?:QUOTE\\s+)?(${LIC_WORDS}|RENEWAL)S?\\s+(?:FOR\\s+)?${AGNOSTIC_FAMILY}\\s*$`, "i"));
    if (_m) {
      agnosticFamily = _m[2].toUpperCase();
    }
  }
  if (!agnosticFamily && modifiers.licenseOnly) {
    _m = upper.trim().match(new RegExp(`^(?:QUOTE\\s+)?(\\d+)\\s*[X\xD7]?\\s*${AGNOSTIC_FAMILY}\\s*(ENT(?:ERPRISE)?)?$`, "i"));
    if (_m) {
      agnosticQty = parseInt(_m[1]);
      agnosticFamily = _m[2].toUpperCase();
    }
  }
  if (agnosticFamily && !isAdvisory) {
    let licSkus;
    if (agnosticFamily === "MR") {
      licSkus = [
        { baseSku: "LIC-ENT-1YR", qty: agnosticQty, isLicenseOnly: true },
        { baseSku: "LIC-ENT-3YR", qty: agnosticQty, isLicenseOnly: true },
        { baseSku: "LIC-ENT-5YR", qty: agnosticQty, isLicenseOnly: true }
      ];
    } else if (agnosticFamily === "MV") {
      licSkus = [
        { baseSku: "LIC-MV-1YR", qty: agnosticQty, isLicenseOnly: true },
        { baseSku: "LIC-MV-3YR", qty: agnosticQty, isLicenseOnly: true },
        { baseSku: "LIC-MV-5YR", qty: agnosticQty, isLicenseOnly: true }
      ];
    } else if (agnosticFamily === "MT") {
      licSkus = [
        { baseSku: "LIC-MT-1Y", qty: agnosticQty, isLicenseOnly: true },
        { baseSku: "LIC-MT-3Y", qty: agnosticQty, isLicenseOnly: true },
        { baseSku: "LIC-MT-5Y", qty: agnosticQty, isLicenseOnly: true }
      ];
    }
    if (licSkus) {
      return {
        items: licSkus,
        isQuote: true,
        isTermOptionQuote: true
        // reuse same 1Y/3Y/5Y URL output path
      };
    }
  }
  const skuPatterns = [
    /C9[23]\d{2}[LX]?-[\dA-Z]+-[\dA-Z]+-M(?:-O)?/gi,
    /C8[14]\d{2}-G2-MX/gi,
    /MA-[A-Z0-9-]+/gi,
    /CW9\d{3}[A-Z0-9]*/gi,
    /MS150-[\dA-Z]+-[\dA-Z]+/gi,
    /MS450-\d+/gi,
    // MS switches: model + 1 dash-segment, + optional -I (internal-PSU variant,
    // e.g. MS130-8P-I — the only multi-segment non-MS150 MS hardware SKU), + optional
    // -RF. -I is deliberately NOT a generic 2nd segment: a broad (?:-[\dA-Z]+)? swallowed
    // -HW / term suffixes and broke validation (MS130-8P-HW → no quote).
    /MS[12345]\d{2}R?-[\dA-Z]+(?:-I)?(?:-RF)?/gi,
    /(?:MR|MV|MT|MG)\d+[A-Z]?(?![A-Z])/gi,
    /MX\d+[A-Z]*(?:-NA)?/gi,
    /Z\d+C?X?/gi
  ];
  const bareAgnosticItems = [];
  if (modifiers.licenseOnly) {
    const bareRe = /\b(\d+)\s*[X×]?\s*(MR|MV|MT)(?:'?S)?\b/gi;
    let bareMatch;
    while ((bareMatch = bareRe.exec(upper)) !== null) {
      const family = bareMatch[2].toUpperCase();
      const qty = parseInt(bareMatch[1]);
      const pos = bareMatch.index;
      const afterChar = upper[pos + bareMatch[0].length];
      if (afterChar && /\d/.test(afterChar)) continue;
      bareAgnosticItems.push({ baseSku: `${family}-AGN`, qty, position: pos, _agnosticFamily: family });
    }
  }
  const rawMatches = [];
  const matched = /* @__PURE__ */ new Set();
  for (const pattern of skuPatterns) {
    let match;
    while ((match = pattern.exec(upper)) !== null) {
      let sku = match[0];
      const pos = match.index;
      if (sku.endsWith("S") && sku.length > 3) {
        const stripped = sku.slice(0, -1);
        const strippedValid = VALID_SKUS.has(stripped) || detectFamily(stripped) !== null;
        const fullValid = VALID_SKUS.has(sku);
        if (strippedValid && !fullValid) sku = stripped;
      }
      if (sku.endsWith("X") && sku.length > 3) {
        const stripped = sku.slice(0, -1);
        const strippedValid = VALID_SKUS.has(stripped) || detectFamily(stripped) !== null;
        const fullValid = VALID_SKUS.has(sku);
        if (strippedValid && !fullValid) sku = stripped;
      }
      if (matched.has(sku)) continue;
      matched.add(sku);
      const before = upper.slice(Math.max(0, pos - 20), pos);
      const after = upper.slice(pos + match[0].length, pos + match[0].length + 15);
      let qty = 1;
      const beforeQty = before.match(/(?:^|[^A-Z0-9])(\d+)\s*[X×]?\s*(?:OF\s+)?(?:THE\s+)?$/);
      const afterQty = after.match(/^[ \t]*[X×]?[ \t]*(\d+)(?![A-Z0-9]|[A-Z]*-|[ \t]*-?Y(?:R|EAR|EARS)?\b)/i);
      qty = inlineModelQuantity(before, after, beforeQty, afterQty);
      rawMatches.push({ baseSku: sku, qty, position: pos });
    }
  }
  const bareFamilyPatterns = [
    { re: /\bMS150\b(?!-)/gi, family: "MS150" },
    { re: /\bMS130\b(?!-\d)/gi, family: "MS130" },
    // MS130 bare, but not MS130-24P etc.
    { re: /\bMS390\b(?!-)/gi, family: "MS390" },
    { re: /\bMS450\b(?!-)/gi, family: "MS450" },
    { re: /\bC9300L?\b(?!-)/gi, family: "C9300" },
    // C9300 or C9300L bare
    { re: /\bC9200L\b(?!-)/gi, family: "C9200L" },
    { re: /\bCW\b(?!\d)/gi, family: "CW" }
    // bare "CW" without model number
  ];
  for (const { re, family } of bareFamilyPatterns) {
    let m;
    while ((m = re.exec(upper)) !== null) {
      const pos = m.index;
      const alreadyCovered = rawMatches.some(
        (rm) => pos >= rm.position && pos < rm.position + rm.baseSku.length
      );
      if (alreadyCovered) continue;
      const before = upper.slice(Math.max(0, pos - 20), pos);
      const after = upper.slice(pos + m[0].length, pos + m[0].length + 15);
      let qty = 1;
      const beforeQty = before.match(/(?:^|[^A-Z0-9])(\d+)\s*[X×]?\s*(?:OF\s+)?(?:THE\s+)?$/);
      const afterQty = after.match(/^\s*[X×]?\s*(\d+)(?![A-Z0-9]|\s*-?Y(?:R|EAR|EARS)?\b)/i);
      if (afterQty) qty = parseInt(afterQty[1]);
      else if (beforeQty) qty = parseInt(beforeQty[1]);
      rawMatches.push({ baseSku: family, qty, position: pos });
    }
  }
  const foundItems = rawMatches.filter((item, idx) => {
    return !rawMatches.some((other, otherIdx) => {
      if (idx === otherIdx) return false;
      return other.baseSku.length > item.baseSku.length && other.baseSku.includes(item.baseSku);
    });
  });
  for (const bare of bareAgnosticItems) {
    const family = bare._agnosticFamily;
    const alreadyHasFamily = foundItems.some((f) => f.baseSku.startsWith(family) && f.baseSku !== `${family}-AGN`);
    if (!alreadyHasFamily) {
      foundItems.push(bare);
    }
  }
  if (smeBareMention && !isAdvisory && (!smeInfoQuestion || smeExplicitQuoteVerb) && foundItems.length > 0) {
    const alreadyHasSme = foundItems.some((f) => f.baseSku === "SME-AGN");
    if (!alreadyHasSme) {
      foundItems.push({ baseSku: "SME-AGN", qty: smeBareMention.qty, position: smeBareMention.position });
    }
  }
  foundItems.sort((a, b) => a.position - b.position);
  const items = foundItems.map(({ baseSku, qty, position }) => ({ baseSku, qty, position }));
  assignClauseIntent(items, upper, modifiers);
  const revisionPatterns = [
    /\b(REMOVE|DROP|TAKE OUT|DELETE|STRIP|EXCLUDE)\b.*(LICENSE|HARDWARE|HW|AP|SWITCH|MX|MR)/,
    /\b(REMOVE|DROP|TAKE OUT|DELETE|STRIP|EXCLUDE)\b.*(FROM|THE|THAT|THOSE)/,
    /\b(ADD|INCLUDE|THROW IN|TACK ON)\b.*\b(MORE|EXTRA|ADDITIONAL|ALSO)\b/,
    /\b(CHANGE|UPDATE|MODIFY|ADJUST|SWITCH)\b.*(QUANTITY|QTY|COUNT|NUMBER|TERM|LICENSE|TIER)/,
    /\b(MAKE (IT|THAT|THEM))\b.*(INSTEAD|RATHER)/,
    /\b(ACTUALLY|NEVER\s?MIND|SCRATCH THAT|WAIT)\b/,
    /\bINSTEAD OF\b/,
    /\b(JUST|ONLY)\s+(THE\s+)?(LICENSE|HARDWARE|HW)\b/,
    /\bSWITCH (TO|IT TO)\b/,
    /\bBUMP (IT |THAT |THE )?(UP|DOWN|TO)\b/
  ];
  const isRevision = revisionPatterns.some((p) => p.test(upper));
  const unresolvedCategories = [];
  const WIFI_CAT_RE = /(?:(\d+)\s*[x×]?\s*)?(?:the\s+)?(?:meraki\s+|cisco\s+)?(?:wi[\s-]?fi|wifi)\s*(7|6e|6)\s*(?:ap|aps|access\s*points?)\b/gi;
  let _wcm;
  const _seenCats = /* @__PURE__ */ new Set();
  while ((_wcm = WIFI_CAT_RE.exec(text)) !== null) {
    const qty = _wcm[1] ? parseInt(_wcm[1]) : 1;
    const gen = _wcm[2].toUpperCase();
    const key = `${gen}:${qty}`;
    if (_seenCats.has(key)) continue;
    _seenCats.add(key);
    const alreadyResolved = items.some(({ baseSku }) => {
      const bu = baseSku.toUpperCase();
      if (gen === "7") return /^CW917/.test(bu);
      if (gen === "6E") return /^CW916/.test(bu);
      if (gen === "6") return /^MR/.test(bu);
      return false;
    });
    if (alreadyResolved) continue;
    unresolvedCategories.push({ kind: "ap", generation: gen, qty });
  }
  if (items.length === 0 && unresolvedCategories.length > 0 && !isAdvisory && !isRevision) {
    const msg = _formatUnresolvedCategoryPrompt(unresolvedCategories, { preamble: true });
    return {
      items: [],
      isQuote: false,
      isClarification: true,
      clarificationMessage: msg,
      unresolvedCategories
    };
  }
  if (items.length === 0) {
    if (isRevision || isAdvisory) {
      return { items: [], requestedTerm, modifiers, requestedTier, isAdvisory, isRevision, showPricing, unresolvedCategories };
    }
    return null;
  }
  return { items, requestedTerm, modifiers, requestedTier, isAdvisory, isRevision, showPricing, unresolvedCategories };
}
__name(parseMessage, "parseMessage");
function _formatUnresolvedCategoryPrompt(cats, { preamble = false } = {}) {
  const GEN_OPTIONS = {
    "7": { label: "Wi-Fi 7", skus: ["CW9172I", "CW9174I", "CW9176D1", "CW9176I", "CW9178I"], note: "indoor enterprise" },
    "6E": { label: "Wi-Fi 6E", skus: ["CW9162I", "CW9164I", "CW9166D1", "CW9166I", "CW9167I"], note: "indoor enterprise" },
    "6": { label: "Wi-Fi 6", skus: ["MR36", "MR44", "MR46", "MR57", "MR76"], note: "indoor enterprise" }
  };
  const lines = [];
  if (preamble) lines.push(`Which access point model do you want?`);
  for (const { generation, qty } of cats) {
    const opt = GEN_OPTIONS[generation];
    if (!opt) continue;
    const qtyStr = qty > 1 ? ` (qty: ${qty})` : "";
    lines.push(`**${opt.label} AP${qtyStr}** \u2014 ${opt.skus.join(", ")}`);
  }
  lines.push(`Reply with the specific model (e.g., "${GEN_OPTIONS[cats[0].generation]?.skus[0] || "CW9172I"}") and I'll add it to the quote.`);
  return lines.join("\n");
}
__name(_formatUnresolvedCategoryPrompt, "_formatUnresolvedCategoryPrompt");
function formatPrice(num) {
  return "$" + num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
__name(formatPrice, "formatPrice");
function buildPricingBlock(urlItems, showPricing) {
  if (!showPricing) return "";
  urlItems = applyEolSwaps(urlItems).lines.filter((l) => l.valid !== false);
  let lines = [];
  let cartTotal = 0;
  for (const { sku, qty } of urlItems) {
    const priceData = getPrice(sku);
    if (priceData) {
      const lineTotal = priceData.price * qty;
      cartTotal += lineTotal;
      lines.push(`\u2022 ${qty} \xD7 ${sku} \u2014 ${formatPrice(priceData.price)} each (${formatPrice(lineTotal)})`);
    } else {
      lines.push(`\u2022 ${qty} \xD7 ${sku} \u2014 price not available`);
    }
  }
  if (cartTotal > 0) {
    lines.push(`**Cart Total: ${formatPrice(cartTotal)}**`);
  }
  return "\n" + lines.join("\n");
}
__name(buildPricingBlock, "buildPricingBlock");
function buildQuoteResponse(parsed) {
  if (!parsed) return { message: null, needsLlm: true };
  const invalidDirectLicenses = normalizeParsedDirectLicenses(parsed);
  if (invalidDirectLicenses.length > 0) {
    return {
      message: parsed.clarificationNote ? `I couldn't quote ${invalidDirectLicenses.join(", ")}. ${parsed.clarificationNote}` : `I couldn't quote ${invalidDirectLicenses.join(", ")} because it is not a recognized switch license SKU.`,
      needsLlm: false
    };
  }
  const _buildUpgradeMap = /* @__PURE__ */ __name((eolList, uplinkIdx) => {
    const _p = /* @__PURE__ */ __name((r) => Array.isArray(r) ? r[uplinkIdx || 0] : r, "_p");
    const pairs = [];
    const seen = /* @__PURE__ */ new Set();
    for (const item of eolList) {
      const src = item.baseSku || item.baseModel;
      const tgt = _p(item.replacement);
      const key = `${src}\u2192${tgt}`;
      if (!seen.has(key)) {
        seen.add(key);
        pairs.push(key);
      }
    }
    return pairs.join(", ");
  }, "_buildUpgradeMap");
  if (parsed.isTermOptionQuote && parsed.items) {
    const separateQuotes = Boolean(parsed.modifiers && parsed.modifiers.separateQuotes);
    const termGroups = { "1YR": [], "3YR": [], "5YR": [] };
    for (const item of parsed.items) {
      const termMatch = item.baseSku.match(/(\d)Y(?:R|-S\d+)?$/i);
      if (termMatch) {
        const key = `${termMatch[1]}YR`;
        if (termGroups[key]) termGroups[key].push({ sku: item.baseSku, qty: item.qty });
      }
    }
    const lines2 = [];
    if (separateQuotes) {
      const tierFamilies = /* @__PURE__ */ new Map();
      for (const item of parsed.items) {
        const tierKey = item.baseSku.replace(/-(\d)Y(?:R|-S\d+)?$/i, "");
        if (!tierFamilies.has(tierKey)) {
          let label = tierKey.replace(/^LIC-/, "").replace(/-K9$/, "").replace(/-/g, " ").replace(/\bDUO\b/, "Duo").replace(/\bUMB\b/, "Umbrella").replace(/\bESSENTIALS\b/i, "Essentials").replace(/\bADVANTAGE\b/i, "Advantage").replace(/\bPREMIER\b/i, "Premier").replace(/\bESS\b/i, "Essentials").replace(/\bADV\b/i, "Advantage").replace(/\bDNS\b/i, "DNS").replace(/\bSIG\b/i, "SIG").replace(/^L AC APX$/i, "AnyConnect Apex").replace(/^L AC PLS$/i, "AnyConnect Plus").replace(/\bL AC APX\b/i, "AnyConnect Apex").replace(/\bL AC PLS\b/i, "AnyConnect Plus");
          tierFamilies.set(tierKey, label.trim());
        }
      }
      for (const [tierKey, label] of tierFamilies) {
        lines2.push(`**${label}:**`);
        for (const term of ["1YR", "3YR", "5YR"]) {
          const matching = termGroups[term].filter((s) => s.sku.replace(/-(\d)Y(?:R|-S\d+)?$/i, "") === tierKey);
          if (matching.length > 0) {
            const url = buildStratusUrl(matching);
            lines2.push(`${term.replace("YR", "-Year")} Co-Term: ${url}`);
            if (parsed.showPricing === true) {
              lines2.push(buildPricingBlock(matching, true).trim());
            }
          }
        }
        lines2.push("");
      }
      const _msgA = lines2.join("\n").trim();
      return { message: parsed.clarificationNote ? `_${parsed.clarificationNote}_

${_msgA}` : _msgA, needsLlm: false };
    }
    const renderedBlocks = [];
    for (const [term, skus] of Object.entries(termGroups)) {
      if (skus.length > 0) {
        const url = buildStratusUrl(skus);
        let block = `**${term.replace("YR", "-Year")} Co-Term:** ${url}`;
        if (parsed.showPricing === true) {
          block += "\n" + buildPricingBlock(skus, true).trim();
        }
        renderedBlocks.push(block);
      }
    }
    const _msgB = renderedBlocks.join("\n\n");
    return { message: parsed.clarificationNote ? `_${parsed.clarificationNote}_

${_msgB}` : _msgB, needsLlm: false };
  }
  if (parsed.directLicenseList) {
    const lines2 = [];
    const _primary = /* @__PURE__ */ __name((r) => Array.isArray(r) ? r[0] : r, "_primary");
    const _hasAlt = /* @__PURE__ */ __name((r) => Array.isArray(r) && r.length > 1, "_hasAlt");
    let detectedTerm = null;
    for (const { sku } of parsed.directLicenseList) {
      const termMatch = sku.match(/(\d+)\s*Y(?:R|EA|-S\d+)?$/i);
      if (termMatch) {
        detectedTerm = parseInt(termMatch[1]);
        break;
      }
    }
    const requestedTerm = parsed.requestedTerm ? Number(parsed.requestedTerm) : null;
    const canRenderAllTerms = canRewriteDirectLicenseListForAllTerms(parsed.directLicenseList);
    const canRenderRequestedTerm = requestedTerm ? canRewriteDirectLicenseListForTerm(parsed.directLicenseList, requestedTerm) : false;
    const shouldRewriteDirectLicenseTerms = canRenderAllTerms || canRenderRequestedTerm;
    const terms2 = requestedTerm ? canRenderRequestedTerm ? [requestedTerm] : detectedTerm ? [detectedTerm] : [requestedTerm] : canRenderAllTerms ? [1, 3, 5] : detectedTerm ? [detectedTerm] : [1, 3, 5];
    const requestedTier2 = parsed.requestedTier || null;
    const eolFound = [];
    for (const { sku, qty } of parsed.directLicenseList) {
      const modelMatch = sku.match(/^LIC-(MS\d{3}-[A-Z0-9]+)-\d+Y/i) || sku.match(/^LIC-(MX\d+[A-Z]*)-[A-Z]+-\d+Y/i) || sku.match(/^LIC-(Z\d+[A-Z]*)-[A-Z]+-\d+Y/i) || sku.match(/^LIC-(MG\d+[A-Z]*)-[A-Z]+-\d+Y/i);
      if (modelMatch) {
        const baseModel = modelMatch[1].toUpperCase();
        if (isEol(baseModel)) {
          const replacement = checkEol(baseModel);
          if (replacement) {
            eolFound.push({ baseModel, replacement, sku, qty });
          }
        }
      }
    }
    if (eolFound.length > 0) {
      lines2.push(`**Products End of Life:**`);
      for (const { baseModel, replacement } of eolFound) {
        if (_hasAlt(replacement)) {
          lines2.push(`\u2022 ${baseModel} (EOL) \u2192 Replacements: ${replacement[0]} (1G) / ${replacement[1]} (10G)`);
        } else {
          lines2.push(`\u2022 ${baseModel} (EOL) \u2192 Replacement: ${_primary(replacement)}`);
        }
      }
      lines2.push("");
    }
    lines2.push(`**Option 1 - Renew As-Is:**`);
    lines2.push("");
    for (const term of terms2) {
      const termItems = shouldRewriteDirectLicenseTerms ? rewriteDirectLicenseListForTerm(parsed.directLicenseList, term) : parsed.directLicenseList;
      const url = buildStratusUrl(termItems);
      const termLabel = term === 1 ? "1-Year Co-Term" : term === 3 ? "3-Year Co-Term" : "5-Year Co-Term";
      lines2.push(`${termLabel}: ${url}`);
      if (parsed.showPricing === true) {
        const priceItems = termItems.map((l) => ({ sku: l.sku, qty: l.qty }));
        lines2.push(buildPricingBlock(priceItems, true).trim());
      }
      lines2.push("");
    }
    if (eolFound.length > 0) {
      const hasDualUplink = eolFound.some(({ replacement }) => _hasAlt(replacement));
      const _buildRefreshItems = /* @__PURE__ */ __name((term, uplinkIdx) => {
        const urlItems = [];
        const processedEolModels = /* @__PURE__ */ new Set();
        for (const { sku, qty } of parsed.directLicenseList) {
          const eolEntry = eolFound.find((e) => e.sku === sku);
          if (eolEntry && !processedEolModels.has(eolEntry.baseModel)) {
            processedEolModels.add(eolEntry.baseModel);
            const repl = _hasAlt(eolEntry.replacement) ? eolEntry.replacement[uplinkIdx] : _primary(eolEntry.replacement);
            const replHwSku = applySuffix(repl);
            const replLicenses = getLicenseSkus(repl, requestedTier2);
            urlItems.push({ sku: replHwSku, qty });
            if (replLicenses) {
              const licSku = replLicenses.find((l) => l.term === `${term}Y`)?.sku;
              if (licSku) urlItems.push({ sku: licSku, qty });
            }
          } else if (!eolEntry) {
            const rewritten = shouldRewriteDirectLicenseTerms ? directLicenseSkuForTerm(sku, term) : null;
            urlItems.push({ sku: rewritten || sku, qty });
          }
        }
        return urlItems;
      }, "_buildRefreshItems");
      const _buildHardwareBreakdownLic = /* @__PURE__ */ __name((uplinkIdx) => {
        const hwMap = /* @__PURE__ */ new Map();
        const processedModels = /* @__PURE__ */ new Set();
        for (const { baseModel, qty, replacement } of eolFound) {
          if (processedModels.has(baseModel)) continue;
          processedModels.add(baseModel);
          const repl = _hasAlt(replacement) ? replacement[uplinkIdx] : _primary(replacement);
          const replHwSku = applySuffix(repl);
          if (!hwMap.has(replHwSku)) hwMap.set(replHwSku, { total: 0, parts: [] });
          const entry = hwMap.get(replHwSku);
          entry.total += qty;
          entry.parts.push({ qty, source: `replacing ${baseModel}` });
        }
        if (hwMap.size === 0) return [];
        const bdLines = [];
        for (const [hwSku, { total, parts }] of hwMap) {
          if (parts.length === 1) {
            bdLines.push(`\u2022 ${hwSku} \xD7 ${total} (${parts[0].source})`);
          } else {
            const detail = parts.map((p) => `${p.qty} ${p.source}`).join(" + ");
            bdLines.push(`\u2022 ${hwSku} \xD7 ${total} (${detail})`);
          }
        }
        return bdLines;
      }, "_buildHardwareBreakdownLic");
      if (hasDualUplink) {
        lines2.push(`**Option 2 - Hardware Refresh, 1G Uplink:**`);
        lines2.push("");
        lines2.push(..._buildHardwareBreakdownLic(0));
        lines2.push("");
        for (const term of terms2) {
          const urlItems = _buildRefreshItems(term, 0);
          if (urlItems.length > 0) {
            const url = buildStratusUrl(urlItems);
            const termLabel = term === 1 ? "1-Year Co-Term" : term === 3 ? "3-Year Co-Term" : "5-Year Co-Term";
            lines2.push(`${termLabel}: ${url}`);
            lines2.push("");
          }
        }
        lines2.push(`**Option 3 - Hardware Refresh, 10G Uplink:**`);
        lines2.push("");
        lines2.push(..._buildHardwareBreakdownLic(1));
        lines2.push("");
        for (const term of terms2) {
          const urlItems = _buildRefreshItems(term, 1);
          if (urlItems.length > 0) {
            const url = buildStratusUrl(urlItems);
            const termLabel = term === 1 ? "1-Year Co-Term" : term === 3 ? "3-Year Co-Term" : "5-Year Co-Term";
            lines2.push(`${termLabel}: ${url}`);
            lines2.push("");
          }
        }
      } else {
        lines2.push(`**Option 2 - Hardware Refresh:**`);
        lines2.push("");
        lines2.push(..._buildHardwareBreakdownLic(0));
        lines2.push("");
        for (const term of terms2) {
          const urlItems = _buildRefreshItems(term, 0);
          if (urlItems.length > 0) {
            const url = buildStratusUrl(urlItems);
            const termLabel = term === 1 ? "1-Year Co-Term" : term === 3 ? "3-Year Co-Term" : "5-Year Co-Term";
            lines2.push(`${termLabel}: ${url}`);
            lines2.push("");
          }
        }
      }
    }
    let _msg = lines2.join("\n").trim();
    const _dlNote = [parsed.note, parsed.clarificationNote].filter(Boolean).join(" ");
    if (_dlNote) _msg = `_${_dlNote}_

${_msg}`;
    return { message: _msg, needsLlm: false };
  }
  if (parsed.directLicense) {
    const { sku, qty } = parsed.directLicense;
    const url = buildStratusUrl([{ sku, qty }]);
    let message = url;
    if (parsed.showPricing === true) message += buildPricingBlock([{ sku, qty }], true);
    const directNote = [parsed.clarificationNote, parsed.note].filter(Boolean).join(" ");
    if (directNote) {
      message = `_${directNote}_

${message}`;
    }
    return { message, needsLlm: false };
  }
  if (parsed.isAdvisory) return { message: null, needsLlm: true, advisory: true };
  if (parsed.isRevision && parsed.items.length === 0) return { message: null, needsLlm: true, revision: true };
  const terms = parsed.requestedTerm ? [parsed.requestedTerm] : [1, 3, 5];
  const modifiers = parsed.modifiers || { hardwareOnly: false, licenseOnly: false };
  const requestedTier = parsed.requestedTier || null;
  const sme5yrNote = /* @__PURE__ */ __name((term, urlItems) => (urlItems || []).some((i) => i.smeReplaced) && String(term) === String(terms[terms.length - 1]) ? `
_${SME_EOL_FLAG}_` : "", "sme5yrNote");
  const eolItems = [];
  const errors = [];
  const resolvedItems = [];
  const tierWarnings = [];
  let noTermSplit = false;
  const ordered = [];
  for (let { baseSku, qty, hardwareOnly: itemHardwareOnly, licenseOnly: itemLicenseOnly, _v3PreLicense, smeReplaced: itemSmeReplaced } of parsed.items) {
    if (Array.isArray(_v3PreLicense) && _v3PreLicense.length) {
      const preItem = { baseSku, hwSku: null, qty, licenseSkus: _v3PreLicense, eol: false, isAgnosticLicense: true, hardwareOnly: false, licenseOnly: true, smeReplaced: Boolean(itemSmeReplaced) };
      resolvedItems.push(preItem);
      ordered.push({ kind: "resolved", ref: preItem });
      continue;
    }
    const agnMatch = baseSku.match(/^(MR|MV|MT|SME)-AGN$/);
    if (agnMatch) {
      const family = agnMatch[1];
      let licSkus;
      if (family === "MR") {
        licSkus = [
          { term: "1Y", sku: "LIC-ENT-1YR" },
          { term: "3Y", sku: "LIC-ENT-3YR" },
          { term: "5Y", sku: "LIC-ENT-5YR" }
        ];
      } else if (family === "MV") {
        licSkus = [
          { term: "1Y", sku: "LIC-MV-1YR" },
          { term: "3Y", sku: "LIC-MV-3YR" },
          { term: "5Y", sku: "LIC-MV-5YR" }
        ];
      } else if (family === "MT") {
        licSkus = [
          { term: "1Y", sku: "LIC-MT-1Y" },
          { term: "3Y", sku: "LIC-MT-3Y" },
          { term: "5Y", sku: "LIC-MT-5Y" }
        ];
      } else if (family === "SME") {
        licSkus = [
          { term: "1Y", sku: `${SME_REPLACEMENT_BASE}-1YR` },
          { term: "3Y", sku: `${SME_REPLACEMENT_BASE}-3YR` },
          { term: "5Y", sku: `${SME_REPLACEMENT_BASE}-5YR` }
        ];
      }
      const agnItem = { baseSku: family === "SME" ? "Systems Manager" : `${family} Enterprise`, hwSku: null, qty, licenseSkus: licSkus, eol: false, isAgnosticLicense: true, smeReplaced: family === "SME", hardwareOnly: itemHardwareOnly, licenseOnly: itemLicenseOnly };
      resolvedItems.push(agnItem);
      ordered.push({ kind: "resolved", ref: agnItem });
      continue;
    }
    const bUpper = baseSku.toUpperCase();
    if (/^CW9(16|17)\d$/.test(bUpper) && !bUpper.endsWith("I")) {
      baseSku = `${bUpper}I`;
    }
    const preLic = baseSku.match(/^LIC-.+-([135])Y(?:R)?(?:-S\d+)?$/i);
    if (preLic) {
      const _preSmeReplaced = /^LIC-SME-/i.test(baseSku);
      const effectiveSku = _preSmeReplaced ? smeReplacementSku(preLic[1]) : baseSku;
      const preItem = {
        baseSku: effectiveSku,
        hwSku: null,
        qty,
        licenseSkus: [{ term: `${preLic[1]}Y`, sku: effectiveSku }],
        eol: false,
        isAgnosticLicense: true,
        hardwareOnly: false,
        licenseOnly: true,
        smeReplaced: _preSmeReplaced
      };
      resolvedItems.push(preItem);
      ordered.push({ kind: "resolved", ref: preItem });
      continue;
    }
    const validation = validateSku(baseSku);
    if (!validation.valid) {
      if (validation.suggest && validation.suggest.length > 0 && (validation.isPartialMatch || validation.isFuzzyMatch || validation.isCommonMistake)) {
        let msg = `\u26A0\uFE0F **${baseSku.toUpperCase()}** \u2014 which variant do you need?`;
        for (const s of validation.suggest.slice(0, 8)) msg += `
\u2022 ${s}`;
        errors.push(msg);
      } else {
        const suggest = validation.suggest ? `
Did you mean: ${validation.suggest.slice(0, 3).join(", ")}?` : "";
        errors.push(`\u26A0\uFE0F **${baseSku}**: ${validation.reason}${suggest}`);
      }
      continue;
    }
    const eol = isEol(baseSku);
    const replacement = checkEol(baseSku);
    if (eol && replacement) {
      const eolItem = { baseSku, qty, replacement, eol: true, hardwareOnly: itemHardwareOnly, licenseOnly: itemLicenseOnly };
      eolItems.push(eolItem);
      ordered.push({ kind: "eol", ref: eolItem });
      continue;
    }
    const zTest = baseSku.toUpperCase().match(/^Z(\d+)/);
    if (zTest) {
      const zNum = zTest[1];
      if ((zNum === "1" || zNum === "3") && requestedTier && requestedTier !== "ENT") {
        tierWarnings.push(`\u26A0\uFE0F **${baseSku}** only supports Enterprise licensing. Using ENT.`);
      }
      if (zNum === "4" && requestedTier === "SDW") {
        tierWarnings.push(`\u26A0\uFE0F **${baseSku}** does not support SD-WAN licensing. Using ENT.`);
      }
    }
    const hwSku = applySuffix(baseSku);
    const licenseSkus = getLicenseSkus(baseSku, requestedTier);
    const resItem = { baseSku, hwSku, qty, licenseSkus, eol: false, hardwareOnly: itemHardwareOnly, licenseOnly: itemLicenseOnly };
    resolvedItems.push(resItem);
    ordered.push({ kind: "resolved", ref: resItem });
  }
  if (errors.length > 0 && resolvedItems.length === 0 && eolItems.length === 0) {
    const allPartialMatches = parsed.items.every(({ baseSku }) => {
      const v = validateSku(baseSku);
      return v.valid || !v.valid && (v.isPartialMatch || v.isFuzzyMatch || v.isCommonMistake) && v.suggest && v.suggest.length > 0;
    });
    if (allPartialMatches) {
      const lines2 = [];
      for (const { baseSku } of parsed.items) {
        const v = validateSku(baseSku);
        if (v.valid) continue;
        const upper = baseSku.toUpperCase();
        if (v.suggest && v.suggest.length === 1) {
          lines2.push(`\u26A0\uFE0F **${upper}** is not a recognized SKU. Did you mean **${v.suggest[0]}**?`);
        } else if (v.isFuzzyMatch || v.reason) {
          lines2.push(`\u26A0\uFE0F **${upper}** is not a recognized SKU.${v.reason && !v.reason.includes("not a recognized") ? " " + v.reason + "." : ""} Did you mean:`);
          for (const s of v.suggest) lines2.push(`\u2022 ${s}`);
        } else {
          const family = detectFamily(upper);
          const familyLabel = family || upper;
          const portMatch = baseSku.match(/\d+$/);
          const portHint = portMatch ? ` ${portMatch[0]}-port` : "";
          lines2.push(`I found multiple ${familyLabel}${portHint} variants. Which one do you need?`);
          for (const s of v.suggest) lines2.push(`\u2022 ${s}`);
        }
      }
      return { message: lines2.join("\n"), needsLlm: false };
    }
    return { message: null, needsLlm: true, errors };
  }
  let lines = [];
  if (parsed.clarificationNote) lines.push(`_${parsed.clarificationNote}_`, "");
  if (errors.length > 0) {
    const variantPrompts = [];
    const trueErrors = [];
    for (const err of errors) {
      if (err.includes("\u2022") || err.includes("Which one do you need?") || err.includes("Did you mean") || err.includes("which variant do you need")) {
        variantPrompts.push(err);
      } else {
        trueErrors.push(err);
      }
    }
    if (trueErrors.length > 0) {
      lines.push(...trueErrors, "");
      lines.push("_The items above could not be quoted._", "");
    }
    if (variantPrompts.length > 0) {
      lines.push(...variantPrompts, "");
    }
  }
  if (tierWarnings.length > 0) lines.push(...tierWarnings, "");
  if (eolItems.length > 0) {
    const _primary = /* @__PURE__ */ __name((r) => Array.isArray(r) ? r[0] : r, "_primary");
    const _hasAlt = /* @__PURE__ */ __name((r) => Array.isArray(r) && r.length > 1, "_hasAlt");
    lines.push(`**Products End of Life:**`);
    for (const { baseSku, replacement } of eolItems) {
      if (_hasAlt(replacement)) {
        lines.push(`\u2022 ${baseSku} (EOL) \u2192 Replacements: ${replacement[0]} (1G) / ${replacement[1]} (10G)`);
      } else {
        lines.push(`\u2022 ${baseSku} (EOL) \u2192 Replacement: ${_primary(replacement)}`);
      }
    }
    lines.push("");
    const _getEolRenewalLicenses = /* @__PURE__ */ __name((baseSku) => {
      const lics = getLicenseSkus(baseSku, requestedTier);
      if (lics) return lics;
      const legacyMatch = baseSku.toUpperCase().match(/^(MS\d{3})-(.+)/);
      if (legacyMatch) {
        return [
          { term: "1Y", sku: `LIC-${legacyMatch[1]}-${legacyMatch[2]}-1YR` },
          { term: "3Y", sku: `LIC-${legacyMatch[1]}-${legacyMatch[2]}-3YR` },
          { term: "5Y", sku: `LIC-${legacyMatch[1]}-${legacyMatch[2]}-5YR` }
        ];
      }
      return null;
    }, "_getEolRenewalLicenses");
    const hasRenewLicenses = eolItems.some(({ baseSku }) => _getEolRenewalLicenses(baseSku));
    if (hasRenewLicenses) {
      const opt1Lines = [];
      for (const term of terms) {
        const urlItems = [];
        for (const entry of ordered) {
          const itHw = entry.ref.hardwareOnly ?? modifiers.hardwareOnly;
          const itLic = entry.ref.licenseOnly ?? modifiers.licenseOnly;
          const explicitHw = entry.ref.hardwareOnly === true;
          if (entry.kind === "eol") {
            const { baseSku, qty } = entry.ref;
            const renewLicenses = _getEolRenewalLicenses(baseSku);
            if (renewLicenses && !itHw) {
              const licSku = renewLicenses.find((l) => l.term === `${term}Y`)?.sku;
              if (licSku) urlItems.push({ sku: licSku, qty });
            }
          } else {
            const { hwSku, qty, licenseSkus, isAgnosticLicense, smeReplaced } = entry.ref;
            if (!itLic && (!itHw || explicitHw) && !isAgnosticLicense) urlItems.push({ sku: hwSku, qty });
            if (licenseSkus && !itHw) {
              const licSku = licenseSkus.find((l) => l.term === `${term}Y`)?.sku;
              if (licSku) urlItems.push({ sku: licSku, qty, smeReplaced });
            }
          }
        }
        if (urlItems.length > 0) {
          const url = buildStratusUrl(urlItems);
          const termLabel = term === 1 ? "1-Year Co-Term" : term === 3 ? "3-Year Co-Term" : "5-Year Co-Term";
          opt1Lines.push(`${termLabel}: ${url}${sme5yrNote(term, urlItems)}`);
          opt1Lines.push("");
        }
      }
      if (opt1Lines.length > 0) {
        lines.push(modifiers.licenseOnly ? `**Option 1 - Renew As-Is:**` : `**Option 1 - As Quoted:**`);
        lines.push("");
        lines.push(...opt1Lines);
      }
    }
    const hasDualUplink = eolItems.some(({ replacement }) => _hasAlt(replacement));
    const _buildRefreshItems = /* @__PURE__ */ __name((term, uplinkIdx) => {
      const urlItems = [];
      for (const entry of ordered) {
        const itHw = entry.ref.hardwareOnly ?? modifiers.hardwareOnly;
        const itLic = entry.ref.licenseOnly ?? modifiers.licenseOnly;
        const explicitHw = entry.ref.hardwareOnly === true;
        if (entry.kind === "eol") {
          const { qty, replacement } = entry.ref;
          const repl = _hasAlt(replacement) ? replacement[uplinkIdx] : _primary(replacement);
          const replHwSku = applySuffix(repl);
          const replLicenses = getLicenseSkus(repl, requestedTier);
          urlItems.push({ sku: replHwSku, qty });
          if (replLicenses && !itHw) {
            const licSku = replLicenses.find((l) => l.term === `${term}Y`)?.sku;
            if (licSku) urlItems.push({ sku: licSku, qty });
          }
        } else {
          const { hwSku, qty, licenseSkus, isAgnosticLicense, smeReplaced } = entry.ref;
          if (!itLic && (!itHw || explicitHw) && !isAgnosticLicense) urlItems.push({ sku: hwSku, qty });
          if (licenseSkus && !itHw) {
            const licSku = licenseSkus.find((l) => l.term === `${term}Y`)?.sku;
            if (licSku) urlItems.push({ sku: licSku, qty, smeReplaced });
          }
        }
      }
      return urlItems;
    }, "_buildRefreshItems");
    const _buildHardwareBreakdown = /* @__PURE__ */ __name((uplinkIdx) => {
      const hwMap = /* @__PURE__ */ new Map();
      for (const { baseSku, qty, replacement } of eolItems) {
        const repl = _hasAlt(replacement) ? replacement[uplinkIdx] : _primary(replacement);
        const replHwSku = applySuffix(repl);
        if (!hwMap.has(replHwSku)) hwMap.set(replHwSku, { total: 0, parts: [] });
        const entry = hwMap.get(replHwSku);
        entry.total += qty;
        entry.parts.push({ qty, source: `replacing ${baseSku}` });
      }
      {
        for (const it of resolvedItems) {
          const { hwSku, qty } = it;
          if (it.licenseOnly ?? modifiers.licenseOnly) continue;
          if (!hwMap.has(hwSku)) hwMap.set(hwSku, { total: 0, parts: [] });
          const entry = hwMap.get(hwSku);
          entry.total += qty;
          entry.parts.push({ qty, source: "existing" });
        }
      }
      if (hwMap.size === 0) return [];
      const bdLines = [];
      for (const [hwSku, { total, parts }] of hwMap) {
        if (parts.length === 1 && parts[0].source === "existing") {
          bdLines.push(`\u2022 ${hwSku} \xD7 ${total}`);
        } else if (parts.length === 1) {
          bdLines.push(`\u2022 ${hwSku} \xD7 ${total} (${parts[0].source})`);
        } else {
          const detail = parts.map((p) => `${p.qty} ${p.source}`).join(" + ");
          bdLines.push(`\u2022 ${hwSku} \xD7 ${total} (${detail})`);
        }
      }
      return bdLines;
    }, "_buildHardwareBreakdown");
    const _buildReplacementAccessorySuggestions = /* @__PURE__ */ __name((uplinkIdx) => {
      const suggestionLines = [];
      const seenStackFamilies = /* @__PURE__ */ new Set();
      const seenModFamilies = /* @__PURE__ */ new Set();
      for (const { qty, replacement } of eolItems) {
        const repl = _hasAlt(replacement) ? replacement[uplinkIdx] : _primary(replacement);
        if (qty >= 2 && !seenStackFamilies.has(repl)) {
          const suggestion = buildStackingSuggestionLine(repl, qty);
          if (suggestion) {
            seenStackFamilies.add(repl);
            suggestionLines.push(suggestion);
          }
        }
        const profile = getPortProfile(repl);
        if (profile && profile.profile.uplinks === "modular" && !seenModFamilies.has(profile.family)) {
          seenModFamilies.add(profile.family);
          const mods = uplinkModules[profile.family];
          if (mods) {
            suggestionLines.push(`\u{1F4A1} **Uplink Module:** ${profile.family} ships without uplink module. Popular choice: ${mods.modules[0].sku} (${mods.modules[0].ports}x ${mods.modules[0].speed} ${mods.modules[0].type}).`);
          }
        }
      }
      for (const { baseSku, qty } of resolvedItems) {
        if (qty >= 2 && !seenStackFamilies.has(baseSku)) {
          const suggestion = buildStackingSuggestionLine(baseSku, qty);
          if (suggestion) {
            seenStackFamilies.add(baseSku);
            suggestionLines.push(suggestion);
          }
        }
        const profile = getPortProfile(baseSku);
        if (profile && profile.profile.uplinks === "modular" && !seenModFamilies.has(profile.family)) {
          seenModFamilies.add(profile.family);
          const mods = uplinkModules[profile.family];
          if (mods) {
            suggestionLines.push(`\u{1F4A1} **Uplink Module:** ${profile.family} ships without uplink module. Popular choice: ${mods.modules[0].sku} (${mods.modules[0].ports}x ${mods.modules[0].speed} ${mods.modules[0].type}).`);
          }
        }
      }
      return suggestionLines;
    }, "_buildReplacementAccessorySuggestions");
    if (hasDualUplink) {
      lines.push(`**Option 2 - Hardware Refresh, 1G Uplink:**`);
      lines.push("");
      lines.push(..._buildHardwareBreakdown(0));
      lines.push("");
      for (const term of terms) {
        const urlItems = _buildRefreshItems(term, 0);
        if (urlItems.length > 0) {
          const url = buildStratusUrl(urlItems);
          const termLabel = term === 1 ? "1-Year Co-Term" : term === 3 ? "3-Year Co-Term" : "5-Year Co-Term";
          lines.push(`${termLabel}: ${url}${sme5yrNote(term, urlItems)}`);
          lines.push("");
        }
      }
      const opt2Suggestions = _buildReplacementAccessorySuggestions(0);
      for (const s of opt2Suggestions) {
        lines.push(s);
      }
      if (opt2Suggestions.length > 0) lines.push("");
      lines.push(`**Option 3 - Hardware Refresh, 10G Uplink:**`);
      lines.push("");
      lines.push(..._buildHardwareBreakdown(1));
      lines.push("");
      for (const term of terms) {
        const urlItems = _buildRefreshItems(term, 1);
        if (urlItems.length > 0) {
          const url = buildStratusUrl(urlItems);
          const termLabel = term === 1 ? "1-Year Co-Term" : term === 3 ? "3-Year Co-Term" : "5-Year Co-Term";
          lines.push(`${termLabel}: ${url}${sme5yrNote(term, urlItems)}`);
          lines.push("");
        }
      }
      const opt3Suggestions = _buildReplacementAccessorySuggestions(1);
      for (const s of opt3Suggestions) {
        lines.push(s);
      }
      if (opt3Suggestions.length > 0) lines.push("");
    } else {
      lines.push(`**Option 2 - Hardware Refresh:**`);
      lines.push("");
      lines.push(..._buildHardwareBreakdown(0));
      lines.push("");
      for (const term of terms) {
        const urlItems = _buildRefreshItems(term, 0);
        if (urlItems.length > 0) {
          const url = buildStratusUrl(urlItems);
          const termLabel = term === 1 ? "1-Year Co-Term" : term === 3 ? "3-Year Co-Term" : "5-Year Co-Term";
          lines.push(`${termLabel}: ${url}${sme5yrNote(term, urlItems)}`);
          lines.push("");
        }
      }
      const opt2Suggestions = _buildReplacementAccessorySuggestions(0);
      for (const s of opt2Suggestions) {
        lines.push(s);
      }
      if (opt2Suggestions.length > 0) lines.push("");
    }
    if (resolvedItems.length > 0) {
      if (parsed.showPricing) {
        const allItems = [];
        for (const it of resolvedItems) {
          const { hwSku, qty, licenseSkus, isAgnosticLicense } = it;
          const itHw = it.hardwareOnly ?? modifiers.hardwareOnly;
          const itLic = it.licenseOnly ?? modifiers.licenseOnly;
          if (!itLic && !isAgnosticLicense) allItems.push({ sku: hwSku, qty });
          if (licenseSkus && !itHw) {
            const licSku = licenseSkus.find((l) => l.term === "3Y")?.sku;
            if (licSku) allItems.push({ sku: licSku, qty });
          }
        }
        lines.push(buildPricingBlock(allItems, false));
      }
      return { message: lines.join("\n").trim(), needsLlm: false };
    }
  }
  if (resolvedItems.length === 0 && eolItems.length === 0) {
    return { message: null, needsLlm: true, errors };
  }
  if (resolvedItems.length > 0) {
    const allAccessories = resolvedItems.every(
      (item) => (!item.licenseSkus || item.licenseSkus.length === 0) && (item.baseSku?.toUpperCase().startsWith("MA-") || item.hwSku?.toUpperCase().startsWith("MA-"))
    );
    if (allAccessories) {
      const urlItems = resolvedItems.map((i) => ({ sku: i.hwSku, qty: i.qty }));
      const url = buildStratusUrl(urlItems);
      lines.push(url);
      if (parsed.showPricing) lines.push(buildPricingBlock(urlItems, true));
      lines.push("");
      noTermSplit = true;
    } else if (resolvedItems.every((it) => it.hardwareOnly ?? modifiers.hardwareOnly)) {
      const urlItems = [];
      for (const { hwSku, qty, isAgnosticLicense } of resolvedItems) {
        if (!isAgnosticLicense) urlItems.push({ sku: hwSku, qty });
      }
      if (urlItems.length > 0) {
        const url = buildStratusUrl(urlItems);
        lines.push(url);
        if (parsed.showPricing) lines.push(buildPricingBlock(urlItems, true));
        lines.push("");
      }
    } else if (modifiers.separateQuotes && resolvedItems.length > 1) {
      for (const item of resolvedItems) {
        const { baseSku, hwSku, qty, licenseSkus, isAgnosticLicense, smeReplaced } = item;
        const itemHardwareOnly = item.hardwareOnly ?? modifiers.hardwareOnly;
        const itemLicenseOnly = item.licenseOnly ?? modifiers.licenseOnly;
        const label = baseSku || hwSku || "Quote";
        lines.push(`**${label} \xD7 ${qty}:**`);
        for (const term of terms) {
          const urlItems = [];
          if (!itemLicenseOnly && !isAgnosticLicense) urlItems.push({ sku: hwSku, qty });
          if (licenseSkus && !itemHardwareOnly) {
            const licSku = licenseSkus.find((l) => l.term === `${term}Y`)?.sku;
            if (licSku) urlItems.push({ sku: licSku, qty, smeReplaced });
          }
          if (urlItems.length > 0) {
            const url = buildStratusUrl(urlItems);
            const termLabel = term === 1 ? "1-Year Co-Term" : term === 3 ? "3-Year Co-Term" : "5-Year Co-Term";
            lines.push(`${termLabel}: ${url}${sme5yrNote(term, urlItems)}`);
            if (parsed.showPricing) lines.push(buildPricingBlock(urlItems, true));
          }
        }
        lines.push("");
      }
    } else {
      for (const term of terms) {
        const urlItems = [];
        for (const it of resolvedItems) {
          const { hwSku, qty, licenseSkus, isAgnosticLicense, smeReplaced } = it;
          const itemHardwareOnly = it.hardwareOnly ?? modifiers.hardwareOnly;
          const itemLicenseOnly = it.licenseOnly ?? modifiers.licenseOnly;
          if (!itemLicenseOnly && !isAgnosticLicense) urlItems.push({ sku: hwSku, qty });
          if (licenseSkus && !itemHardwareOnly) {
            const licSku = licenseSkus.find((l) => l.term === `${term}Y`)?.sku;
            if (licSku) urlItems.push({ sku: licSku, qty, smeReplaced });
          }
        }
        if (urlItems.length > 0) {
          const url = buildStratusUrl(urlItems);
          const termLabel = term === 1 ? "1-Year Co-Term" : term === 3 ? "3-Year Co-Term" : "5-Year Co-Term";
          lines.push(`**${termLabel}:** ${url}${sme5yrNote(term, urlItems)}`);
          if (parsed.showPricing) lines.push(buildPricingBlock(urlItems, true));
          lines.push("");
        }
      }
    }
  }
  const stackableFamilies = /* @__PURE__ */ new Set();
  for (const { baseSku, qty } of parsed.items) {
    if (qty >= 2 && !isEol(baseSku)) {
      const suggestion = buildStackingSuggestionLine(baseSku, qty);
      if (suggestion && !stackableFamilies.has(baseSku)) {
        stackableFamilies.add(baseSku);
        lines.push("");
        lines.push(suggestion);
      }
    }
  }
  const modularFamiliesFound = /* @__PURE__ */ new Set();
  for (const { baseSku } of parsed.items) {
    if (isEol(baseSku)) continue;
    const profile = getPortProfile(baseSku);
    if (profile && profile.profile.uplinks === "modular" && !modularFamiliesFound.has(profile.family)) {
      modularFamiliesFound.add(profile.family);
      const mods = uplinkModules[profile.family];
      if (mods) {
        lines.push("");
        lines.push(`\u{1F4A1} **Uplink Module:** ${profile.family} ships without uplink module. Popular choice: ${mods.modules[0].sku} (${mods.modules[0].ports}x ${mods.modules[0].speed} ${mods.modules[0].type}).`);
      }
    }
  }
  if (parsed.unresolvedCategories && parsed.unresolvedCategories.length > 0) {
    lines.push("");
    lines.push(`\u26A0\uFE0F **AP model not specified** \u2014 the quote above covers the other items. ${_formatUnresolvedCategoryPrompt(parsed.unresolvedCategories, { preamble: false })}`);
  }
  return { message: lines.join("\n").trim(), needsLlm: false, noTermSplit };
}
__name(buildQuoteResponse, "buildQuoteResponse");
var SYSTEM_PROMPT = `You are Stratus AI, the internal quoting assistant for Stratus Information Systems, a Cisco-exclusive reseller specializing in Meraki networking products.

## YOUR ROLE
You are the fallback when our deterministic quoting engine can't resolve a request. You'll typically see ambiguous SKUs, partial product names, common mistakes, natural language questions, or follow-up requests referencing prior context.

## REASONING APPROACH
Think through each request step by step before generating URLs:
1. Identify what products the user is asking about
2. Verify each SKU exists in the catalog below. NEVER assume a product exists. NEVER invent SKUs, pricing, or specifications.
3. Apply the correct hardware suffix
4. Pair with the correct license SKU and term format
5. Build the URL

If a product can't be found, ask the user to clarify. Suggest the closest alternatives from the catalog.

## LIVE DATASHEET CAPABILITY (you DO have this \u2014 never deny it)
This worker has a built-in 'fetchDatasheet' function that pulls live content from documentation.meraki.com for every model in DATASHEET_URLS. When the user asks you to "pull the (full) datasheet", "fetch the latest datasheet", "scan the datasheet", "get specifics from the datasheet", or any equivalent phrasing, the worker fetches the page server-side BEFORE you see this prompt and injects the fetched content under the '## LIVE DATASHEET CONTENT' header below. Use that content as the authoritative source.

NEVER reply with "I don't have the ability to browse URLs" or "I can only work with injected content" or "I cannot fetch live web pages". Those statements are FALSE for this bot. If the live-datasheet section is missing from this prompt for some reason, say "I couldn't pull the datasheet just now \u2014 the fetch came back empty or incomplete." Do NOT claim the capability doesn't exist and do NOT ask the user to send a new message to retry.

When you offer to "pull the full datasheet" / "verify against the datasheet" / "check the latest specs", you ARE offering a real capability. The user's "yes please / pull it / try again" replies trigger a live fetch on THE SAME TURN they send \u2014 the worker re-runs fetchDatasheet server-side BEFORE you see the next prompt, then injects the fresh content under '## LIVE DATASHEET CONTENT' for you to use directly. NEVER tell the user to "send another message to trigger the fetch", "please resend your request as a new message", "a fresh trigger will pull the complete page", or "try again to fetch" \u2014 by the time you're answering THIS turn, the fetch already ran. If '## LIVE DATASHEET CONTENT' is present in this prompt, use it. If it's missing, the fetch came back empty \u2014 say so plainly and offer a different model or alternative.

## CRITICAL ANTI-HALLUCINATION RULES
- NEVER state product specifications unless they are provided in this prompt via a "PRODUCT SPECS" section.
- If no specs are provided and the user asks about throughput, user counts, performance, etc., say: "I don't have verified specs for that model in my current data. Want me to pull the latest datasheet?"
- When listing model options or variants, ONLY list models from the VALID PRODUCT CATALOG section. Never suggest model numbers that aren't explicitly listed.
- If conversation history contains specs that conflict with an injected PRODUCT SPECS section, the injected specs are ALWAYS correct.

## WEBEX FORMATTING \u2014 ABSOLUTE RULE (applies to EVERY reply, no exceptions)
Your reply renders in Webex, which does NOT render pipe-delimited markdown tables. ANY row that uses pipe characters as column separators \u2014 including 2-column comparison tables, "winners" tables, pros/cons tables, summary tables, bottom-line tables, or any other table \u2014 will render as literal "|" characters and look broken.
**NEVER output a line that starts and ends with a pipe character.** NEVER output a separator row like "|---|---|".

Replace tables with one of these formats:
- Grouped bullets under a bolded header: "**MS150** \u2014 wins on per-port PoE (60W), cost"
- Inline bullet pairs: "\u2022 High per-port PoE: MS150   \u2022 25G uplinks: C9200L"
- Prose sentences with bolded keywords.

This rule is non-negotiable and overrides any instinct to use tables for "clarity" \u2014 tables are not clear in Webex, they are broken.

## PERSONA
Professional, concise, action-oriented. Give direct answers without conversational fluff. Short answers for well-defined questions. Positive and engaging tone. You're a knowledgeable colleague, not a help desk.

## STRATUS CONTEXT
Stratus Information Systems is a Cisco-exclusive reseller specializing in Meraki cloud-managed networking. We serve K-12, higher ed, healthcare, and enterprise customers. Our quoting tool generates instant order URLs that populate a cart on stratusinfosystems.com.

## URL FORMAT
https://stratusinfosystems.com/order/?item={item1},{item2}&qty={qty1},{qty2}

Items and quantities are separate comma-separated lists in matching order.

## SKU SUFFIX RULES
- Most MS switches (MS120/125/130/130R/210/225/250/350/390/425/450) \u2192 add -HW
- MR, MV, MT, MG, Z (not Z4X/Z4CX) \u2192 add -HW
- MX non-cellular \u2192 add -HW
- MX cellular (MXxxC, MXxxCW) \u2192 add -HW-NA
- CW Wi-Fi 6E (CW916x) \u2192 add -MR
- CW Wi-Fi 7 (CW917x) \u2192 add -RTG
- MS150, C9200/C9300 (ending in 4G/4X), C8xxx, MA- accessories \u2192 no suffix (these families end in 4G/4X like Catalyst switches)
- Z4X, Z4CX \u2192 no suffix (sold as-is)

IMPORTANT: CW9166I and CW9164I are CURRENT Wi-Fi 6E access points (use -MR suffix). They are NOT end-of-life. Do NOT substitute MR36 or any other replacement. Only SKUs listed in the EOL replacements map should be treated as EOL.

## LICENSE RULES (CRITICAL \u2014 term suffix format matters! Follow EXACTLY)
Three license tiers exist for MX/Z:
- ENT (Enterprise): Available for ALL product families
- SEC (Advanced Security): Available for MX (all models), Z4/Z4C. DEFAULT for MX and Z4/Z4C.
- SDW (SD-WAN): Available for MX (all models) only. ALWAYS uses -Y suffix regardless of model age.

**Systems Manager (LIC-SME) is DISCONTINUED \u2014 every LIC-SME term is inactive in Zoho and must never be quoted. Quote the replacement instead: LIC-MI-EMSC-D-1YMC-A-{1YR|3YR|5YR} (Ivanti Neurons for MDM per device) at the requested term with a 50-device minimum quantity, and tell the user about the substitution.**

**vMX licenses require an edition \u2014 editionless LIC-VMX-{S|M|L|XL}-{n}YR forms are retired. Quote LIC-VMX-{size}-{ENT|SEC}-{n}Y (SEC when the customer runs Advanced Security, else ENT). Never auto-size a model-number vMX like LIC-VMX100 \u2014 ask for the size. Meraki Insight (LIC-MI-S/M/L) is RETIRED: never quote it; upgrade the customer's MX license from -SEC- to -SDW- (SD-WAN Plus) instead and flag the change. LIC-MI-EMSC-\u2026 is Ivanti MDM, NOT Insight.**

EXACT license SKU mappings by product family:

### APs (MR + CW) \u2014 all use generic ENT license
- All MR and CW APs \u2192 LIC-ENT-1YR, LIC-ENT-3YR, LIC-ENT-5YR (note: -YR suffix)
- CW9800 wireless controllers \u2192 NO license association

### Systems Manager (SME) \u2014 generic, model-agnostic
- "Systems Manager", "SME", "SME license" \u2192 LIC-MI-EMSC-D-1YMC-A-1YR, LIC-MI-EMSC-D-1YMC-A-3YR, LIC-MI-EMSC-D-1YMC-A-5YR (note: -YR suffix). Cisco Meraki Systems Manager (LIC-SME) is DISCONTINUED in every term \u2014 never emit any LIC-SME SKU; always quote the replacement (Ivanti Neurons for MDM per device) and flag the substitution. A 50-device minimum applies \u2014 quote at least qty 50. Model-agnostic like MR/MV/MT \u2014 quote all three terms unless a single term is named.
- vMX licenses REQUIRE an edition: quote LIC-VMX-{S|M|L|XL}-{ENT|SEC}-{1|3|5}Y. Editionless forms (LIC-VMX-S-3YR) are retired \u2014 pick the edition from the customer's MX lines (SEC if they run Advanced Security, else ENT). NEVER auto-size a model-number vMX (LIC-VMX100) \u2014 ask which size.
- Meraki Insight (LIC-MI-S/M/L) is RETIRED \u2014 never quote it. Its features moved to SD-WAN Plus: upgrade the customer's MX license from -SEC- to -SDW- instead and flag the change. LIC-MI-EMSC-\u2026 is the Ivanti MDM product, NOT Insight.

### MX Security Appliances \u2014 term suffix depends on model number
- MX67, MX67W, MX67C, MX68, MX68W, MX68CW, MX250, MX450 (older) \u2192 -YR suffix
  Examples: LIC-MX67-SEC-1YR, LIC-MX68CW-SEC-3YR, LIC-MX250-SEC-5YR
- MX75, MX85, MX95, MX105 (newer) \u2192 -Y suffix
  Examples: LIC-MX75-SEC-1Y, LIC-MX85-SEC-3Y, LIC-MX95-ENT-5Y
- MX cellular (-NA variants): license uses the C/CW model WITHOUT -NA
  Examples: MX67C-HW-NA \u2192 LIC-MX67C-SEC-1YR, MX68CW-HW-NA \u2192 LIC-MX68CW-SEC-1YR
- SDW tier ALWAYS uses -Y suffix: LIC-MX85-SDW-1Y, LIC-MX67-SDW-1Y

### Z-Series
- Z1, Z3, Z3C (legacy) \u2192 ENT only, -YR suffix: LIC-Z1-ENT-1YR, LIC-Z3C-ENT-3YR
- Z4, Z4C \u2192 SEC default, -Y suffix: LIC-Z4-SEC-1Y, LIC-Z4C-SEC-3Y
- Z4X, Z4CX \u2192 same as Z4/Z4C (X is hardware suffix only, not in license SKU)

### MG Cellular Gateways \u2014 -Y suffix, strip E from model
- MG21/MG21E \u2192 LIC-MG21-ENT-1Y, -3Y, -5Y
- MG41/MG41E \u2192 LIC-MG41-ENT-1Y, -3Y, -5Y
- MG51/MG51E \u2192 LIC-MG51-ENT-1Y, -3Y, -5Y
- MG52/MG52E \u2192 LIC-MG52-ENT-1Y, -3Y, -5Y

### MV Cameras \u2014 generic, -YR suffix
- ALL MV models \u2192 LIC-MV-1YR, LIC-MV-3YR, LIC-MV-5YR

### MT Sensors \u2014 generic, -Y suffix
- ALL MT models \u2192 LIC-MT-1Y, LIC-MT-3Y, LIC-MT-5Y

### MS130 Switches \u2014 -Y suffix
- Compact (8/8P/8X/8P-I/12X, MS130R-8P) \u2192 LIC-MS130-CMPT-1Y, -3Y, -5Y
- Standard \u2192 LIC-MS130-{24|48}-1Y, -3Y, -5Y

### MS150 Switches \u2014 -Y suffix
- All variants \u2192 LIC-MS150-{24|48}-1Y, -3Y, -5Y (port count only, ignore uplink)

### MS390 Switches \u2014 port count + tier, -Y suffix
- MS390-24UX \u2192 LIC-MS390-24E-1Y, -3Y, -5Y
- MS390-48UX \u2192 LIC-MS390-48E-1Y, -3Y, -5Y
- Use port count only (24 or 48), drop variant letters. Tier A or E (default E).

### MS450 Switches \u2014 -Y suffix
- MS450-12 \u2192 LIC-MS450-12E-1Y, -3Y, -5Y

### Catalyst C9300-M \u2014 port count + tier, -Y suffix
- C9300-24T-M, C9300-24P-M, etc. \u2192 LIC-C9300-24E-1Y, -3Y, -5Y
- C9300-48T-M, C9300-48P-M, C9300-48UXM-M, etc. \u2192 LIC-C9300-48E-1Y, -3Y, -5Y

### Catalyst C9300X-M \u2014 MAPS TO C9300 licenses (C9300X has NO its own license SKUs!)
- C9300X-24Y-M, C9300X-24HX-M \u2192 LIC-C9300-24E-1Y, -3Y, -5Y
- C9300X-48TX-M, C9300X-48HX-M, C9300X-48HXN-M \u2192 LIC-C9300-48E-1Y, -3Y, -5Y
- C9300X-12Y-M \u2192 LIC-C9300-24E-1Y, -3Y, -5Y (12-port uses 24-port license!)

### Catalyst C9300L-M \u2014 MAPS TO C9300 licenses (C9300L has NO its own license SKUs!)
- C9300L-24T-4X-M, C9300L-24P-4X-M, etc. \u2192 LIC-C9300-24E-1Y, -3Y, -5Y
- C9300L-48T-4X-M, C9300L-48P-4X-M, etc. \u2192 LIC-C9300-48E-1Y, -3Y, -5Y

### Catalyst C9200L-M \u2014 -Y suffix
- C9200L-24T-4G-M, C9200L-24P-4X-M, etc. \u2192 LIC-C9200L-24E-1Y, -3Y, -5Y
- C9200L-48T-4G-M, C9200L-48P-4X-M, etc. \u2192 LIC-C9200L-48E-1Y, -3Y, -5Y

### Catalyst C9350 \u2014 NO 1Y option, only 3Y and 5Y
- C9350-24* \u2192 LIC-C9350-24E-3Y, LIC-C9350-24E-5Y
- C9350-48* \u2192 LIC-C9350-48E-3Y, LIC-C9350-48E-5Y

### Legacy Switches (all EOL) \u2014 -YR suffix
- MS120/125/210/220/225/250/320/350/355/410/420/425 \u2192 LIC-{model}-{variant}-1YR, -3YR, -5YR
  Examples: LIC-MS250-48FP-1YR, LIC-MS350-24X-1YR

## VALID PRODUCT CATALOG
APs (MR): MR28, MR36, MR36H, MR44, MR46, MR46E, MR52, MR57, MR76, MR78, MR86
APs (CW Wi-Fi 6E): CW9162I, CW9163E (external antenna), CW9164I, CW9166I, CW9166D1 (directional)
APs (CW Wi-Fi 7): CW9171I (entry), CW9172I (mid-range, DEFAULT), CW9172H (hospitality), CW9174I (high-perf), CW9176I (premium), CW9176D1 (directional), CW9178I (top-tier), CW9179F (outdoor)
MX Security: MX67, MX67W, MX67C, MX67C-NA, MX68, MX68W, MX68CW, MX68CW-NA, MX75, MX85, MX95, MX105, MX250, MX450
Next-Gen MX / Catalyst Firewalls (Catalyst-based hardware running MX OS \u2014 own license family, NOT MX67/MX68 licenses):
  - C8111-G2-MX: succeeds MX67 form factor (2 Gbps FW, 1.2 Gbps VPN, 4 LAN, 200 users). Licenses: LIC-C8111-{ENT|SEC|SDW}-{1Y|3Y|5Y}.
  - C8121-G2-MX: succeeds MX68 form factor (2 Gbps FW, 1.2 Gbps VPN, 10 LAN, 200 users). Licenses: LIC-C8121-{ENT|SEC|SDW}-{1Y|3Y|5Y}.
  - NEVER associate MX67 or MX68 license SKUs with C8111-G2-MX or C8121-G2-MX. The Catalyst hardware uses its own C8111/C8121 license SKUs.
  - Default tier when user does not specify: SEC (matches MX successor behavior). Use ENT or SDW only when the user explicitly asks for that tier.
MS130 Switches: MS130-8, MS130-8P, MS130-8P-I, MS130-8X, MS130-12X, MS130-24, MS130-24P, MS130-24X, MS130-48, MS130-48P, MS130-48X, MS130R-8P
MS150 Switches: MS150-24T-4G, MS150-24P-4G, MS150-24T-4X, MS150-24P-4X, MS150-24MP-4X, MS150-48T-4G, MS150-48LP-4G, MS150-48FP-4G, MS150-48T-4X, MS150-48LP-4X, MS150-48FP-4X, MS150-48MP-4X
MS390 Switches: MS390-24UX, MS390-48UX, MS390-48UX2
MS450 Switches: MS450-12
Catalyst C9300-M: C9300-24T-M, C9300-24P-M, C9300-24U-M, C9300-24UX-M, C9300-24S-M, C9300-48T-M, C9300-48P-M, C9300-48U-M, C9300-48UXM-M, C9300-48S-M, C9300-48UN-M
Catalyst C9300X-M: C9300X-12Y-M, C9300X-24Y-M, C9300X-24HX-M, C9300X-48TX-M, C9300X-48HX-M, C9300X-48HXN-M
Catalyst C9300L-M: C9300L-24T-4X-M, C9300L-24P-4X-M, C9300L-24UXG-4X-M, C9300L-48T-4X-M, C9300L-48P-4X-M, C9300L-48PF-4X-M, C9300L-48UXG-4X-M
Catalyst C9200L-M: C9200L-24T-4G-M, C9200L-24P-4G-M, C9200L-24T-4X-M, C9200L-24P-4X-M, C9200L-24PXG-4X-M, C9200L-24PXG-2Y-M, C9200L-48T-4G-M, C9200L-48P-4G-M, C9200L-48PL-4G-M, C9200L-48T-4X-M, C9200L-48P-4X-M, C9200L-48PL-4X-M, C9200L-48PXG-4X-M, C9200L-48PXG-2Y-M
MV Cameras: MV2, MV13, MV13M, MV22, MV22X, MV23M, MV23X, MV32, MV33, MV33M, MV52, MV53X, MV63, MV63M, MV63X, MV72, MV72X, MV73X, MV73M, MV84X, MV93, MV93M, MV93X
MT Sensors: MT10, MT11, MT12, MT14, MT15, MT20, MT30, MT40
MG Cellular: MG21, MG21E, MG41, MG41E, MG51, MG51E, MG52, MG52E
Z-Series: Z4, Z4C, Z4X, Z4CX

## EOL PRODUCT KNOWLEDGE
These products are End-of-Life. ALWAYS check every product in a screenshot or request against this list:
- MX: MX60, MX60W, MX64, MX64W, MX65, MX65W, MX80, MX84, MX100, MX400, MX600
- MR: MR12, MR16, MR18, MR20, MR24, MR26, MR30H, MR32, MR33, MR34, MR42, MR42E, MR45, MR52, MR53, MR53E, MR55, MR56, MR62, MR66, MR70, MR72, MR74, MR84
- MV: MV12N, MV12W, MV12WE, MV21, MV22, MV22X, MV32, MV52, MV71, MV72, MV72X
- MS: MS120 (all), MS125 (all), MS210 (all), MS220 (all), MS225 (all), MS250 (all), MS320 (all), MS350 (all), MS355 (all), MS390 (all), MS410 (all), MS420 (all), MS425 (all)
- MG: MG21, MG21E, MG51, MG51E
- Z: Z1, Z3, Z3C
- Licenses: LIC-SME (Systems Manager, all terms), LIC-MI-S/M/L (Meraki Insight), editionless LIC-VMX-{S,M,L,XL}-{n}YR (vMX without ENT/SEC)

Replacements: MX60/64\u2192MX67, MX65\u2192MX68, MX80/84\u2192MX85, MX100\u2192MX95, MX400\u2192MX250, MX600\u2192MX450, MR20\u2192MR28, MR30H\u2192MR36H, MR33\u2192MR36, MR42\u2192MR44, MR45\u2192MR46, MR52/53/56\u2192MR57, MR55\u2192MR57, MR70\u2192MR78, MR74\u2192MR76, MR84\u2192MR86, MV Gen 2\u2192Gen 3, MS120/125\u2192MS130, MS210/220/225\u2192MS130/MS150, MS250\u2192C9300L, MS320\u2192MS150, MS350\u2192C9300, MS355\u2192C9300X, MS390\u2192C9300, MS410/420\u2192C9300, MS425\u2192C9300X, MG21\u2192MG41, MG51\u2192MG52, Z1/3\u2192Z4, Z3C\u2192Z4C
License replacements: LIC-SME\u2192LIC-MI-EMSC-D-1YMC-A-{term}YR (Ivanti Neurons for MDM, 50-device minimum), LIC-MI-S/M/L (Insight)\u2192drop it and upgrade the MX license from -SEC- to -SDW- (SD-WAN Plus), editionless LIC-VMX\u2192LIC-VMX-{size}-{ENT|SEC}-{n}Y (never auto-size a model-number vMX like LIC-VMX100)

When you identify ANY EOL product, flag it using the compact format below (NO EOS dates, NO End-of-Support dates \u2014 those are only shown when explicitly requested). ALWAYS include both Option 1 (renewal, license-only) and Option 2 (hardware refresh with replacement hardware + all licenses). If any replacement switch has 1G/10G uplink variants, show Option 2 (1G Uplink) and Option 3 (10G Uplink). Flag ALL EOL products found regardless of whether they have a license overage \u2014 EOL status is based on the product family, not the license gap.

## AP MODEL DEFAULTS AND UPGRADE TIERS

### Antenna Suffix Defaults
- (I) Internal Antenna = DEFAULT for all APs unless otherwise specified
- (H) Hospitality = only when replacing another H-series AP or when specifically requested
- (E) External Antenna = when replacing an E-series AP or when requested. ALWAYS auto-add 2\xD7 MA-ANT-20 (omni-directional antenna) per AP, as external antenna APs do not include antennas. Notify the user: "\u2139\uFE0F External antenna model selected \u2014 2\xD7 MA-ANT-20 (omni-directional) added per AP (antennas not included by default)."

### MR \u2192 Wi-Fi 7 Tier Mapping (use when user asks for "Wi-Fi 7 equivalent/upgrade")
- MR28 \u2192 CW9171I (entry)
- MR36 \u2192 CW9172I (mid-range)
- MR36H \u2192 CW9172H (hospitality)
- MR44 / MR46 \u2192 CW9174I (high-performance)
- MR46E \u2192 CW9174I + 2\xD7 MA-ANT-20 per AP (external antenna \u2014 see note above)
- MR57 / MR56 / MR52 / MR53 \u2192 CW9178I (top-tier)
- MR76 / MR78 \u2192 CW9179F (outdoor)
- MR86 \u2192 CW9179F (outdoor)

### Wi-Fi 6E: When user asks for "Wi-Fi 6E" without specifying a model, show all available internal antenna options: CW9162I (entry), CW9164I (mid), CW9166I (premium). If the context suggests external antenna, show CW9163E + MA-ANT-20.

### Wi-Fi 7: Default model is CW9172I (internal antenna, mid-range). When user asks for "Wi-Fi 7 AP" without specifying, use CW9172I. Only use CW9172H when replacing an H-series model or when explicitly requested.

### Upgrade Path Priority
Default EOL replacement = MR equivalent (same generation). When user asks for Wi-Fi 6E or Wi-Fi 7 equivalent, use the tier mapping above. When asked for just "upgrade" in the context of APs, default to MR replacement and mention Wi-Fi 7 as an option.

## CISCO SECURITY PRODUCTS (License-Only, No Hardware)
We also quote these Cisco security licenses. They are per-user, per-year licenses with NO hardware component:
- Duo MFA: LIC-DUO-ESSENTIALS, LIC-DUO-ADVANTAGE, LIC-DUO-PREMIER (1YR/3YR/5YR each)
- Umbrella DNS: LIC-UMB-DNS-ESS-K9, LIC-UMB-DNS-ADV-K9 (1YR/3YR/5YR each)
- Umbrella SIG: LIC-UMB-SIG-ESS-K9, LIC-UMB-SIG-ADV-K9 (1YR/3YR/5YR each)
- Cisco AnyConnect / Cisco Secure Client / Cisco VPN: LIC-L-AC-APX-{1,3,5}Y-S1 (Apex tier) and LIC-L-AC-PLS-{1,3,5}Y-S1 (Plus tier). Note -Y suffix (not -YR) and -S1 is required. 25-user minimum. Alias triggers: "AnyConnect", "Any Connect", "Cisco Secure Client", "Secure Client", "Cisco VPN" all map to these SKUs. When tier unspecified, show BOTH Apex and Plus side-by-side so the user can compare features/price.
When a user asks about Duo, Umbrella, or AnyConnect/Secure Client/Cisco VPN licensing, provide quote URLs with 1Y/3Y/5Y options just like hardware quotes. NEVER tell the user AnyConnect is outside our catalog \u2014 it's explicitly supported above.

## LICENSE DASHBOARD SCREENSHOT HANDLING
When a user sends a screenshot of a Meraki license dashboard, ALWAYS use this exact response format:

### If BOTH the license table AND device counts are visible:

**License Analysis:**
\u2022 {License Name}: {licensed count} licensed = {active count} active \u2713   (if match)
\u2022 {License Name}: {licensed count} licensed, {active count} active \u2014 adjusted to {active count}   (if mismatch)
\u2022 {License Name}: 0 devices (skip from renewal)   (if zero active)
\u2022 MT: {count} devices (5 free licenses, {count-5} need licensing)   (if MT > 5)

Apply these mismatch rules:
1. MATCH (license limit = device count): Include at that count.
2. FEWER ACTIVE DEVICES: Include at the LOWER active device count.
3. ZERO ACTIVE DEVICES: REMOVE that license from the renewal.
4. MORE DEVICES THAN LICENSES: Include at the higher device count. Flag the overage.
5. MT SENSORS: Skip if 5 or fewer total. If more than 5, only license the overage (devices minus 5).

### If ONLY the license SKU table is visible (no device counts):
Quote the licenses EXACTLY as shown in the table. Do NOT ask for device counts. Generate renewal URLs immediately.

### After analysis, ALWAYS output in this format:

**Products End of Life:**
\u2022 {MODEL} (EOL) \u2192 Replacement: {REPLACEMENT MODEL}
(list ALL EOL products found \u2014 regardless of overage status. If replacement has 1G/10G variants: "\u2192 Replacements: {MODEL-4G} (1G) / {MODEL-4X} (10G)")

**License Overages (if any):**
\u2022 {device}: licensed {X}, active {Y} \u2014 adjusted to {Y}

**Option 1 - Renew As-Is:**

1-Year Co-Term: {URL with all license SKUs at determined quantities, 1-Year}

3-Year Co-Term: {same SKUs, 3-Year}

5-Year Co-Term: {same SKUs, 5-Year}

If ANY EOL products were found, ALWAYS include a refresh section without being asked:

**Option 2 - Hardware Refresh:**

1-Year Co-Term: {URL with replacement hardware SKUs (-HW suffix) + ALL license SKUs including non-EOL ones, 1-Year}

3-Year Co-Term: {same SKUs, 3-Year}

5-Year Co-Term: {same SKUs, 5-Year}

CRITICAL AGGREGATION RULES FOR REFRESH URLs \u2014 follow ALL three rules:

RULE 1 \u2014 DEDUP REPLACEMENTS: When multiple EOL models map to the SAME replacement SKU, SUM their quantities into ONE URL entry.
Example: MX60W \xD71 + MX64W \xD71 both map to MX67W \u2192 MX67W-HW \xD72, LIC-MX67W-SEC-3YR \xD72 (NOT two separate entries).
Example: MS120-8FP \xD726 + MS220-8P \xD76 both map to MS130-8P \u2192 MS130-8P-HW \xD732.

RULE 2 \u2014 EXISTING DEVICE LICENSE CARRY-FORWARD: When an EOL model's replacement matches a device the customer ALREADY HAS (non-EOL), the refresh URL must include licenses for BOTH the replacement AND the existing device, but hardware ONLY for the replacement (the customer already owns the existing hardware). In build_quote_url, use hardware_qty to specify the replacement-only hardware count while qty covers total licenses.
Example: Z1 \xD71 (EOL \u2192 Z4) + existing Z4 \xD71 (non-EOL) \u2192 pass {model:"Z4", qty:2, hardware_qty:1} \u2192 Z4-HW \xD71 (only the Z1 replacement), LIC-Z4-SEC-3Y \xD72 (one for the Z1\u2192Z4 replacement + one for the existing Z4).

RULE 3 \u2014 BUILD A RUNNING TALLY: Before constructing ANY refresh URL, build a tally of every SKU and its total quantity across all devices (EOL replacements + non-EOL carry-forwards). Hardware for non-EOL devices is EXCLUDED (they already own it). Licenses for non-EOL devices ARE included. Then construct ONE URL from the final tally. Never build the URL device-by-device.

RULE 4 \u2014 ORDERED HARDWARE+LICENSE GROUPING: Maintain the exact device order from the screenshot or request. For each device, place its hardware SKU immediately followed by its license SKU(s) \u2014 NEVER group all hardware first then all licenses. When multiple EOL models merge into one replacement (Rule 1), place the merged entry at the position of the FIRST contributing device. Non-EOL devices appear at their original position with license-only (no hardware).
Example from a license dashboard (top to bottom): MG51, MR Enterprise \xD72, MS220-8P \xD72, MX60, MX60W, MX64W, MX65, MX65W, MX75, Z1, Z4
Correct URL order: MG52-HW,LIC-MG52-ENT-3Y(\xD71), LIC-ENT-3YR(\xD72), MS130-8P-HW,LIC-MS130-CMPT-3Y(\xD72), MX67-HW,LIC-MX67-SEC-3YR(\xD71), MX67W-HW(\xD72),LIC-MX67W-SEC-3YR(\xD72), MX68-HW,LIC-MX68-SEC-3YR(\xD71), MX68W-HW,LIC-MX68W-SEC-3YR(\xD71), LIC-MX75-SEC-3Y(\xD71), Z4-HW(\xD71),LIC-Z4-SEC-3Y(\xD72)
Note: MX67W appears once at MX60W's position (first device mapping to MX67W). MX75 = license-only (non-EOL). Z4-HW \xD71 (only Z1 replacement) but LIC-Z4-SEC-3Y \xD72 (Rule 2: Z1\u2192Z4 + existing Z4). The Z4 entry uses hardware_qty:1 and qty:2.

MANDATORY: Use the build_quote_url tool for ALL URL generation. NEVER manually type out URLs. Pass your parsed device list to the tool and it will handle suffixes, license mapping, dedup, and URL construction. For generic MR Enterprise licenses (no specific AP model), use model "MR-ENT". Call the tool once per URL you need (e.g., once for Option 1 renewal, once for Option 2 refresh). Use hardware_qty when a replacement model matches an existing device (Rule 2).

The refresh option replaces EOL hardware with successors and carries over ALL other licenses from the renewal. If any replacement switch has 1G/10G uplink variants (4G/4X suffix), show Option 2 (1G Uplink) and Option 3 (10G Uplink). Show 1-Year, 3-Year, AND 5-Year URLs for every option (one URL per term) unless the user explicitly asks for a single term.

## REFRESH / UPGRADE / HARDWARE UPGRADE SEMANTICS
When a user asks for a "refresh option" or "upgrade option" in the context of a renewal quote:
- This means a HARDWARE UPGRADE for End-of-Life equipment.
- Replace ALL EOL hardware with successors (not just one \u2014 check every product).
- Include the new hardware SKU with correct suffix (-HW for most, see suffix rules).
- ALWAYS carry over ALL other licenses from the original quote. If the original had MR ENT licenses, MS licenses, etc., include ALL of them in the refresh option.
- "Upgrade" does NOT mean changing the license tier (SEC\u2192SDW) unless the user explicitly says "upgrade to SD-WAN" or "upgrade license".
- Label sections as Option 1 (renewal), Option 2 (refresh / 1G uplink), Option 3 (10G uplink when applicable). Never use "Option A" or "Option B".

## HARDWARE-ONLY MODE
When the user says "hardware only" or "hardware" (without asking about specs/info), they want ONLY hardware SKUs with NO licenses.
- ALWAYS apply the correct -HW suffix (e.g., Z4C \u2192 Z4C-HW, MX67 \u2192 MX67-HW).
- Output a single URL (no 1-Year/3-Year/5-Year breakdown since there are no licenses).

## Z-SERIES DEFAULT LICENSE TIER
Z4 and Z4C default to SEC (Advanced Security) licensing unless the user explicitly requests ENT (Enterprise).

## OUTPUT RULES
- For regular SKU quotes: always show 1-Year, 3-Year, and 5-Year URLs unless user says "just" or "only" with one term.
- URL-only output by default for simple quotes
- Keep responses concise but complete \u2014 never skip EOL products
- NEVER use bullet points (\u2022) before URLs. Just put the URL on its own line after the term label.
- Use bullet points (\u2022) only for License Analysis sections, never for URLs
- NEVER include EOS dates, End-of-Support dates, or lifecycle dates in responses unless the user explicitly asks for EOL dates

## MANDATORY DASHBOARD SCREENSHOT TEMPLATE
When analyzing a Meraki license dashboard screenshot, you MUST follow this EXACT template. Do NOT deviate, do NOT add extra sections, do NOT skip sections. Show 1-Year, 3-Year, AND 5-Year URLs for each option. Use build_quote_url for EVERY URL.

**License Analysis:**
\u2022 [Model]: [qty] licensed = [qty] active \u2713 (or note discrepancies)
\u2022 ... (list ALL devices from screenshot in order, skip MT with 0 devices)

**EOL Devices:**
\u2022 [Model] (EOL) \u2192 [Replacement]
\u2022 ... (list ALL EOL devices)

**Option 1 - Renew As-Is:**
[Call build_quote_url with ALL devices as license_only=true, ONCE PER TERM ("1", "3", "5"). Include every device from the screenshot that has active devices. Use the ORIGINAL model names (not replacements). Skip MT with 0 devices.]

1-Year Co-Term: [URL from tool, term 1]

3-Year Co-Term: [URL from tool, term 3]

5-Year Co-Term: [URL from tool, term 5]

**Option 2 - Hardware Refresh:**
[Call build_quote_url with: EOL devices mapped to their replacements (license_only=false), non-EOL devices as license_only=true, ONCE PER TERM ("1", "3", "5"). Apply Rules 1-4 for dedup, carry-forward, tally, and ordering.]

1-Year Co-Term: [URL from tool, term 1]

3-Year Co-Term: [URL from tool, term 3]

5-Year Co-Term: [URL from tool, term 5]

CRITICAL: You MUST call build_quote_url for BOTH options across all three terms (Option 1: terms 1/3/5; Option 2: terms 1/3/5). NEVER manually construct URLs. Complete BOTH options in a single response. Do NOT stop after the analysis or after Option 1.

## ACCESSORY & CONNECTIVITY GUIDANCE
When asked about SFPs, stacking cables, uplink modules, or how to connect two devices:
- If specific accessory data is injected below this prompt, use it as the authoritative source
- Both ends of a fiber link must match: same speed, same wavelength, same fiber type (MMF/SMF)
- 10G SFP+ ports accept 1G SFP modules (backward compatible). 25G SFP28 accepts 10G/1G.
- 1G SFP ports do NOT accept 10G SFP+ modules.
- MA-SFP-1GB-TX (copper SFP) is NOT supported on MS390, C9300, C9300X, C9300L
- C9300 and MS390 ship without uplink modules. Always ask about uplink needs.
- For stacking, recommend ring topology for production. Ring uses N cables for N switches.
- MS130 does NOT support physical stacking.
- C9300L requires a separate C9300L-STACK-KIT2-M stacking module per switch.
- Default cable recommendation: 1M length for same-rack. Note 50cm and 3M also available.
- When recommending SFPs, ask about fiber type (MMF/SMF) and distance if not specified.
- For same-rack 10G, DAC cables (MA-CBL-TA-1M) are cheapest. For >3m, use SFP+ optics.
- Include quote URLs for recommended accessories whenever possible.`;
var QUOTE_URL_TOOL = {
  name: "build_quote_url",
  description: 'Build a Stratus order URL from a structured device list. ALWAYS use this tool for URL generation \u2014 never manually construct URLs. Pass devices in the order they should appear. The tool handles SKU suffixes, license mapping, dedup, and URL formatting. IMPORTANT for refresh quotes with Rule 2 carry-forward: when an EOL replacement matches a device the customer already owns, pass ONE entry with qty = total license count AND hardware_qty = replacement-only count (e.g., Z1\u2192Z4 + existing Z4 = {model:"Z4", qty:2, hardware_qty:1}).',
  input_schema: {
    type: "object",
    properties: {
      devices: {
        type: "array",
        description: "Ordered list of devices. Each device becomes hardware+license or license-only in the URL.",
        items: {
          type: "object",
          properties: {
            model: { type: "string", description: 'Base model without suffix (e.g., MX67, MS130-8P, Z4, MR44). For MR enterprise licenses without specific model, use "MR-ENT".' },
            qty: { type: "integer", description: "Quantity of this device (used for BOTH hardware and licenses unless hardware_qty overrides hardware count)." },
            hardware_qty: { type: "integer", description: 'Override hardware quantity when it differs from license qty. Use for Rule 2 carry-forward: EOL replacement + existing device \u2192 hardware_qty = replacement count, qty = total licenses. Example: Z1\xD71 (EOL\u2192Z4) + existing Z4\xD71 \u2192 {model:"Z4", qty:2, hardware_qty:1}. Omit to use qty for both.' },
            license_only: { type: "boolean", description: "True if customer already owns hardware (non-EOL). Only license, no hardware SKU." }
          },
          required: ["model", "qty"]
        }
      },
      term: { type: "string", enum: ["1", "3", "5"], description: "License term in years. Default: 3." },
      label: { type: "string", description: 'Label for this URL (e.g., "Option 1 \u2014 Renew As-Is 3-Year", "Option 2 \u2014 Hardware Refresh 3-Year")' },
      hardware_only: { type: "boolean", description: "If true, output only hardware SKUs with no licenses." }
    },
    required: ["devices"]
  }
};
function handleQuoteUrlTool(params) {
  const { devices = [], term = "3", label, hardware_only = false } = params;
  const items = [];
  for (const device of devices) {
    const model = String(device.model || "").trim();
    const qty = parseInt(device.qty, 10) || 1;
    const license_only = !!device.license_only;
    const hwQty = device.hardware_qty != null ? parseInt(device.hardware_qty, 10) : qty;
    if (!model) continue;
    if (model === "MR-ENT" || model === "MR_ENT") {
      const termSuffix = term === "1" ? "1YR" : term === "5" ? "5YR" : "3YR";
      items.push({ sku: `LIC-ENT-${termSuffix}`, qty });
      continue;
    }
    if (!license_only && !hardware_only) {
      if (hwQty > 0) items.push({ sku: applySuffix(model), qty: hwQty });
      const licSkus = getLicenseSkus(model, null);
      if (licSkus) {
        const licEntry = licSkus.find((l) => l.term === `${term}Y`);
        if (licEntry) items.push({ sku: licEntry.sku, qty });
      }
    } else if (license_only) {
      const licSkus = getLicenseSkus(model, null);
      if (licSkus) {
        const licEntry = licSkus.find((l) => l.term === `${term}Y`);
        if (licEntry) items.push({ sku: licEntry.sku, qty });
      }
    } else {
      items.push({ sku: applySuffix(model), qty: hwQty });
    }
  }
  const url = buildStratusUrl(items);
  return { url, label: label || `${term}-Year Co-Term`, items_count: items.length };
}
__name(handleQuoteUrlTool, "handleQuoteUrlTool");
async function askLlamaProductInfo(userMessage, personId, env, classification = null) {
  if (!env.AI) return null;
  try {
    const kv = env.CONVERSATION_KV;
    let wantsLiveDatasheet = /\b(VERIFY|CHECK\s+(THE\s+)?(LATEST|DATASHEET|SPECS?)|LATEST\s+DATASHEET|PULL\s+(?:THE\s+)?(?:(?:FULL|COMPLETE|LATEST|LIVE|WHOLE|UP-TO-DATE)\s+)?DATASHEET|SCAN\s+(?:THE\s+)?(?:(?:FULL|COMPLETE|LATEST|LIVE)\s+)?DATASHEET|CHECK\s+FOR\s+UPDATES|GET\s+SPECIFICS|SPECIFICS\s+(FROM\s+)?(THE\s+)?DATASHEET|FROM\s+(THE\s+)?DATASHEET|WHAT\s+DOES\s+(THE\s+)?DATASHEET\s+SAY|READ\s+(?:THE\s+)?(?:(?:FULL|COMPLETE|LATEST|LIVE)\s+)?DATASHEET|FETCH\s+(?:THE\s+)?(?:(?:FULL|COMPLETE|LATEST|LIVE)\s+)?DATASHEET|GET\s+(?:THE\s+)?(?:(?:FULL|COMPLETE|LATEST|LIVE)\s+)?DATASHEET|GRAB\s+(?:THE\s+)?DATASHEET)\b/i.test(userMessage);
    if (!wantsLiveDatasheet && classification && classification.intent === "product_info") {
      const FOLLOWUP = /\b(SPECIFICS|MORE\s+DETAILS?|TELL\s+ME\s+MORE|KEEP\s+GOING|CONTINUE)\b/i;
      if (FOLLOWUP.test(userMessage)) wantsLiveDatasheet = true;
    }
    let systemPrompt = SYSTEM_PROMPT;
    const sources = { liveModels: [], liveUrls: [], fetchFailed: false, cachedModels: [], categoryFamilies: [] };
    if (wantsLiveDatasheet) {
      let datasheetContext = await getRelevantDatasheetContext(userMessage);
      if (!datasheetContext && personId && kv) {
        const history2 = await getHistory(kv, personId);
        datasheetContext = await getRecentDatasheetRequestContext(history2);
      }
      if (datasheetContext) {
        systemPrompt += "\n\n" + datasheetContext.text;
        systemPrompt += "\n\nThe user is asking for spec details. Use the datasheet content above as the authoritative source.";
        systemPrompt += ` Answer only for these fetched models: ${(datasheetContext.models || []).join(", ")}. Do not include other models from conversation history. Copy source URLs exactly from the [Datasheet: ...] labels.`;
        sources.liveModels.push(...datasheetContext.models || []);
        sources.liveUrls.push(...datasheetContext.urls || []);
      } else {
        sources.fetchFailed = true;
        const staticContext = getStaticSpecsContext(userMessage);
        if (staticContext) {
          systemPrompt += "\n\n" + staticContext.text;
          sources.cachedModels.push(...staticContext.models || []);
        }
      }
    } else {
      const staticContext = getStaticSpecsContext(userMessage);
      if (staticContext) {
        systemPrompt += "\n\n" + staticContext.text;
        sources.cachedModels.push(...staticContext.models || []);
      } else {
        const catUpper = userMessage.toUpperCase();
        const families = [];
        if (/\b(FIREWALL|SECURITY\s*APPLIANCE|MX|GATEWAY)\b/.test(catUpper)) families.push("MX");
        if (/\b(ACCESS\s*POINT|WIFI|WI-?FI|WIRELESS|AP)\b/.test(catUpper)) families.push("MR", "CW");
        if (/\b(SWITCH|SWITCHING)\b/.test(catUpper)) families.push("MS130", "MS150");
        if (/\b(CAMERA|SURVEILLANCE|VIDEO)\b/.test(catUpper)) families.push("MV");
        if (/\b(SENSOR)\b/.test(catUpper)) families.push("MT");
        if (/\b(CELLULAR|LTE|5G|WAN\s*GATEWAY)\b/.test(catUpper)) families.push("MG");
        if (families.length > 0) {
          let ctx = "## PRODUCT SPECS (from specs.json \u2014 AUTHORITATIVE)\n";
          ctx += "Use ONLY these specs. Do NOT supplement with training data. If a spec is not listed here, say you do not have that data and offer to check the datasheet.\n";
          ctx += 'FORMATTING: Webex does NOT render pipe-delimited markdown tables ("| col | col |") \u2014 they show as literal pipes. For multi-model comparisons use grouped bullets under a bolded model header, not tables.\n\n';
          for (const fam of families) {
            const familyData = specs[fam];
            if (familyData) {
              for (const [model, modelSpecs] of Object.entries(familyData)) {
                ctx += `${model}: ${JSON.stringify(modelSpecs)}
`;
              }
            }
          }
          systemPrompt += "\n\n" + ctx;
          sources.categoryFamilies.push(...families);
        }
      }
    }
    const accessoriesContext = getAccessoriesContext(userMessage);
    if (accessoriesContext) systemPrompt += "\n\n" + accessoriesContext;
    systemPrompt += CF_GROUNDING_RULES;
    const history = personId && kv ? await getHistory(kv, personId) : [];
    const cfHistory = history.slice(-6).map((h) => ({ role: h.role, content: h.content }));
    const messages = [
      { role: "system", content: systemPrompt },
      ...cfHistory,
      { role: "user", content: userMessage }
    ];
    const result = await env.AI.run("@cf/meta/llama-4-scout-17b-16e-instruct", {
      messages,
      max_tokens: 1024
    });
    const reply = result?.response ?? result?.choices?.[0]?.message?.content ?? null;
    if (!reply || reply.trim().length < 20) return null;
    let footer = "";
    if (sources.liveModels.length) {
      footer = `

*Live datasheet: ${sources.liveModels.join(", ")}*`;
    } else if (sources.fetchFailed && sources.cachedModels.length) {
      footer = `

*Specs from product database (live datasheet fetch failed). Want me to retry?*`;
    } else if (sources.cachedModels.length) {
      footer = `

*Specs from product database. Want me to pull the latest datasheet to verify?*`;
    } else if (sources.categoryFamilies.length) {
      footer = `

*Specs from product database (${sources.categoryFamilies.join(", ")} family).*`;
    }
    return { reply: reply.trim() + footer, sources };
  } catch (e) {
    console.error("askLlamaProductInfo error:", e && e.message);
    return null;
  }
}
__name(askLlamaProductInfo, "askLlamaProductInfo");
function stripEchoedSourceFooter(reply) {
  if (!reply || typeof reply !== "string") return reply || "";
  const lines = reply.split("\n");
  while (lines.length > 0) {
    const tail = lines[lines.length - 1].trim();
    if (tail === "") {
      lines.pop();
      continue;
    }
    if (/^[*_]?\s*(?:(?:📄|📊|📚)?\s*(?:Source:\s*(?:live\s+)?datasheet|Live\s+datasheet:|\[Datasheet:)|(?:💎\s*)?Claude\s+Sonnet\b)/i.test(tail)) {
      lines.pop();
      continue;
    }
    break;
  }
  return lines.join("\n").trimEnd();
}
__name(stripEchoedSourceFooter, "stripEchoedSourceFooter");
function sanitizeLiveFetchRetryWording(reply) {
  if (!reply || typeof reply !== "string") return reply || "";
  if (!/(datasheet|fetch|worker|trigger|browse|inject|live\s+content)/i.test(reply)) return reply;
  let out = reply;
  out = out.replace(
    /Please resend your request as a new message[\s\S]*?(?:before I respond\.|before I answer\.|server-side and inject the full content before I respond\.)/gi,
    "I tried the live fetch on this turn before answering."
  );
  out = out.replace(
    /\bA fresh trigger will pull the complete page\./gi,
    "The latest fetch still came back incomplete."
  );
  out = out.replace(
    /\(The live fetch will trigger on this request[\s\S]*?I'll flag it and retry\.\)/gi,
    "(The live fetch is attempted on this turn before I answer. If the content is incomplete, I will say so directly.)"
  );
  out = out.replace(
    /\bWant to send another message to trigger the fetch\?/gi,
    "The live fetch came back empty or incomplete."
  );
  out = out.replace(
    /\(The live fetch will inject[\s\S]*?on the next turn\.[\s\S]*?\)/gi,
    "(The live fetch is attempted on this turn before I answer. If the content is incomplete I will say so directly.)"
  );
  out = out.replace(
    /\bThe live fetch will inject[^.\n]*?on the next turn\.[^.\n]*?(?:\.|\n|$)/gi,
    "The live fetch is attempted on this turn before I answer."
  );
  out = out.replace(
    /(?:It looks like\s*)?[Tt]he live content didn'?t inject this round[\s\S]*?(?:second attempt|once more|usually succeed)\.?/gi,
    "The live fetch came back empty or incomplete."
  );
  out = out.replace(
    /\bWant me to retry\?/gi,
    "The live fetch came back empty or incomplete."
  );
  out = out.replace(/\b(?:Just\s+)?[Ss]ay\s+["']?try again["']?[^.!?\n]*?(?:retry|attempt|fetch)[^.!?\n]*[.!?]/gi, "");
  out = out.replace(/\n*A few things that could help:\s*\n+[\s\S]*?(?=\n+\*\*What I can confirm|\n+\*\*What I can't confirm|\n*$)/gi, "\n\n");
  out = out.replace(/\bTry fetching one at a time[^.\n]*\.?/gi, "");
  out = out.replace(/\bTry them one at a time[^.\n]*\.?/gi, "");
  out = out.replace(/\bHere'?s what I'?d suggest:?\s*/gi, "");
  out = out.replace(/\bThese usually succeed on a second attempt\.?/gi, "");
  out = out.replace(/\bthis can occasionally happen if the fetch times? out\.?/gi, "");
  out = out.replace(/\n{3,}/g, "\n\n").trimEnd();
  return out;
}
__name(sanitizeLiveFetchRetryWording, "sanitizeLiveFetchRetryWording");
async function askClaude(userMessage, personId, env, imageData = null, classification = null, ctx = null) {
  if (!env.ANTHROPIC_API_KEY) return "Claude API not configured. Please check ANTHROPIC_API_KEY.";
  const waterfallFlag = String(env.USE_PRODUCT_INFO_WATERFALL || "").trim().toLowerCase();
  const waterfallOn = waterfallFlag === "true" || waterfallFlag === "1" || waterfallFlag === "yes";
  console.log(`[Waterfall] flag=${JSON.stringify(env.USE_PRODUCT_INFO_WATERFALL)} parsed=${waterfallOn} intent=${classification?.intent} hasImg=${!!imageData}`);
  if (waterfallOn && classification && classification.intent === "product_info" && !imageData) {
    const subtype = classifyProductInfoSubtype(userMessage, false);
    console.log(`[Waterfall] subtype=${subtype} for: ${userMessage.substring(0, 60)}`);
    if (subtype === "simple_lookup") {
      const t0 = Date.now();
      const llamaOut = await askLlamaProductInfo(userMessage, personId, env, classification);
      const elapsed = Date.now() - t0;
      if (llamaOut && llamaOut.reply) {
        const kv = env.CONVERSATION_KV;
        if (kv && personId) {
          try {
            await addToHistory(kv, personId, "user", userMessage);
            await addToHistory(kv, personId, "assistant", llamaOut.reply);
          } catch (_) {
          }
        }
        if (ctx && ctx.waitUntil) {
          ctx.waitUntil(logBotUsageToD1(env, {
            personId,
            requestText: userMessage,
            responsePath: "waterfall-llama-product-info",
            model: "@cf/meta/llama-4-scout-17b-16e-instruct",
            durationMs: elapsed,
            responseText: llamaOut.reply
          }).catch(() => {
          }));
        } else {
          logBotUsageToD1(env, {
            personId,
            requestText: userMessage,
            responsePath: "waterfall-llama-product-info",
            model: "@cf/meta/llama-4-scout-17b-16e-instruct",
            durationMs: elapsed,
            responseText: llamaOut.reply
          }).catch(() => {
          });
        }
        const elapsedSec = (elapsed / 1e3).toFixed(1);
        return `${llamaOut.reply}

_\u{1F999} Llama 4 Scout \xB7 CF Workers AI \xB7 ${elapsedSec}s \xB7 free_`;
      }
      console.log("Waterfall: Llama returned empty, falling through to Claude");
    }
  }
  const claudeStartMs = Date.now();
  try {
    const upper = userMessage.toUpperCase();
    let wantsLiveDatasheet = /\b(VERIFY|CHECK\s+(THE\s+)?(LATEST|DATASHEET|SPECS?)|LATEST\s+DATASHEET|PULL\s+(?:THE\s+)?(?:(?:FULL|COMPLETE|LATEST|LIVE|WHOLE|UP-TO-DATE)\s+)?DATASHEET|SCAN\s+(?:THE\s+)?(?:(?:FULL|COMPLETE|LATEST|LIVE)\s+)?DATASHEET|CHECK\s+FOR\s+UPDATES|CHECK\s+IT|MAKE\s+SURE|CONFIRM\s+(THE\s+)?(SPECS?|DATA)|DID\s+YOU\s+CHECK|YES.*DATASHEET|YEAH.*DATASHEET|SURE.*DATASHEET|PLEASE.*DATASHEET|GET\s+SPECIFICS|SPECIFICS\s+(FROM\s+)?(THE\s+)?DATASHEET|FROM\s+(THE\s+)?DATASHEET|WHAT\s+DOES\s+(THE\s+)?DATASHEET\s+SAY|LOOK\s+(IT\s+)?UP|PULL\s+(IT\s+)?UP|DIG\s+INTO|READ\s+(?:THE\s+)?(?:(?:FULL|COMPLETE|LATEST|LIVE)\s+)?DATASHEET|FETCH\s+(?:THE\s+)?(?:(?:FULL|COMPLETE|LATEST|LIVE)\s+)?DATASHEET|GET\s+(?:THE\s+)?(?:(?:FULL|COMPLETE|LATEST|LIVE)\s+)?DATASHEET|GRAB\s+(?:THE\s+)?DATASHEET)\b/i.test(userMessage);
    if (!wantsLiveDatasheet && classification && classification.intent === "product_info") {
      wantsLiveDatasheet = true;
    }
    let systemPrompt = SYSTEM_PROMPT;
    const kv = env.CONVERSATION_KV;
    const sources = {
      liveModels: [],
      // datasheet keys fetched live
      liveUrls: [],
      // URLs that returned content
      fetchFailed: false,
      // live fetch was attempted but returned no content
      cachedModels: [],
      // specs.json model keys resolved
      categoryFamilies: []
      // family-level fallback (MX, MR, MS150, etc.)
    };
    let showFooter = false;
    if (classification && classification.intent === "product_info") showFooter = true;
    if (!wantsLiveDatasheet && isDatasheetRetryFollowup(userMessage) && personId && kv) {
      const recentHistory = await getHistory(kv, personId);
      const recentAssistantTurns = [...recentHistory].reverse().filter((h) => h.role === "assistant").slice(0, 3);
      if (recentAssistantTurns.some((turn) => looksLikeRecentDatasheetTurn(turn.content))) {
        wantsLiveDatasheet = true;
      }
    }
    if (!wantsLiveDatasheet && /^\s*(yes|yeah|yep|yea|sure|please|go ahead|do it)\s*[.!]?\s*$/i.test(userMessage) && personId && kv) {
      const recentHistory = await getHistory(kv, personId);
      const lastAssistant = [...recentHistory].reverse().find((h) => h.role === "assistant");
      if (lastAssistant && /datasheet|check for updates/i.test(lastAssistant.content)) {
        wantsLiveDatasheet = true;
      }
    }
    if (wantsLiveDatasheet) {
      showFooter = true;
      let datasheetFetched = false;
      const datasheetContext = await getRelevantDatasheetContext(userMessage);
      if (!datasheetContext && personId) {
        const history2 = await getHistory(kv, personId);
        let historyContext = await getRecentDatasheetRequestContext(history2);
        if (historyContext) {
          systemPrompt += "\n\n" + historyContext.text;
          systemPrompt += "\n\nThe user has asked you to verify specs against the latest datasheet. Compare the live datasheet data above with what you previously told them and note any differences.";
          systemPrompt += ` Answer only for these fetched models: ${(historyContext.models || []).join(", ")}. Do not include other models from conversation history. Copy source URLs exactly from the [Datasheet: ...] labels.`;
          datasheetFetched = true;
          sources.liveModels.push(...historyContext.models || []);
          sources.liveUrls.push(...historyContext.urls || []);
        }
      } else if (datasheetContext) {
        systemPrompt += "\n\n" + datasheetContext.text;
        systemPrompt += "\n\nThe user requested live datasheet verification. Use the live datasheet content above as the authoritative source.";
        systemPrompt += ` Answer only for these fetched models: ${(datasheetContext.models || []).join(", ")}. Do not include other models from conversation history. Copy source URLs exactly from the [Datasheet: ...] labels.`;
        datasheetFetched = true;
        sources.liveModels.push(...datasheetContext.models || []);
        sources.liveUrls.push(...datasheetContext.urls || []);
      }
      if (!datasheetFetched) {
        sources.fetchFailed = true;
        systemPrompt += "\n\nThe user asked to verify specs against the latest datasheet. The live datasheet fetch was attempted but failed (the page may be temporarily unavailable). Tell the user the datasheet check was attempted but the page was unreachable, and offer to try again. Do NOT say you lack the ability to fetch datasheets \u2014 you DO have this capability, but it failed this time. Fall back to the specs.json data you already have.";
        const recentHistory = await getHistory(kv, personId);
        const lastAssistant = [...recentHistory].reverse().find((h) => h.role === "assistant");
        if (lastAssistant) {
          const staticContext = getStaticSpecsContext(lastAssistant.content);
          if (staticContext) {
            systemPrompt += "\n\n" + staticContext.text;
            sources.cachedModels.push(...staticContext.models || []);
          }
        }
      }
    } else {
      const staticContext = getStaticSpecsContext(userMessage);
      let categoryContext = null;
      let categoryFamilies = [];
      if (!staticContext) {
        const catUpper = userMessage.toUpperCase();
        const families = [];
        if (/\b(FIREWALL|SECURITY\s*APPLIANCE|MX|GATEWAY)\b/.test(catUpper)) families.push("MX");
        if (/\b(ACCESS\s*POINT|WIFI|WI-?FI|WIRELESS|AP)\b/.test(catUpper)) families.push("MR", "CW");
        if (/\b(SWITCH|SWITCHING)\b/.test(catUpper)) families.push("MS130", "MS150");
        if (/\b(CAMERA|SURVEILLANCE|VIDEO)\b/.test(catUpper)) families.push("MV");
        if (/\b(SENSOR)\b/.test(catUpper)) families.push("MT");
        if (/\b(CELLULAR|LTE|5G|WAN\s*GATEWAY)\b/.test(catUpper)) families.push("MG");
        if (families.length > 0) {
          let ctx2 = "## PRODUCT SPECS (from specs.json \u2014 AUTHORITATIVE)\n";
          ctx2 += "Use ONLY these specs. Do NOT supplement with training data. If a spec is not listed here, say you do not have that data and offer to check the datasheet.\n";
          ctx2 += 'FORMATTING: Webex does NOT render pipe-delimited markdown tables ("| col | col |") \u2014 they show as literal pipes. For multi-model comparisons use grouped bullets under a bolded model header, not tables.\n\n';
          for (const fam of families) {
            const familyData = specs[fam];
            if (familyData) {
              for (const [model, modelSpecs] of Object.entries(familyData)) {
                ctx2 += `${model}: ${JSON.stringify(modelSpecs)}
`;
              }
            }
          }
          categoryContext = ctx2;
          categoryFamilies = families;
        }
      }
      if (staticContext) {
        systemPrompt += "\n\n" + staticContext.text;
        sources.cachedModels.push(...staticContext.models || []);
        showFooter = true;
      } else if (categoryContext) {
        systemPrompt += "\n\n" + categoryContext;
        sources.categoryFamilies.push(...categoryFamilies);
        showFooter = true;
      }
    }
    if ((classification?.intent === "product_info" || wantsLiveDatasheet) && sources.liveModels.length === 0 && sources.cachedModels.length === 0 && sources.categoryFamilies.length === 0) {
      const familyDetect = /* @__PURE__ */ __name((text) => {
        const u = (text || "").toUpperCase();
        const fams2 = /* @__PURE__ */ new Set();
        if (/\b(FIREWALL|SECURITY\s*APPLIANCE|GATEWAY)\b/.test(u) || /\bMX/.test(u)) fams2.add("MX");
        if (/\b(ACCESS\s*POINT|WI[\s-]?FI|WIRELESS|\bAP\b)/.test(u) || /\b(MR|CW)/.test(u)) {
          fams2.add("MR");
          fams2.add("CW");
        }
        if (/\b(SWITCH|SWITCHING)\b/.test(u) || /\bMS/.test(u)) {
          fams2.add("MS130");
          fams2.add("MS150");
        }
        if (/\b(CAMERA|SURVEILLANCE|VIDEO)\b/.test(u) || /\bMV/.test(u)) fams2.add("MV");
        if (/\bSENSOR\b/.test(u) || /\bMT/.test(u)) fams2.add("MT");
        if (/\b(CELLULAR|LTE|5G|WAN\s*GATEWAY)\b/.test(u) || /\bMG/.test(u)) fams2.add("MG");
        return [...fams2];
      }, "familyDetect");
      let fams = familyDetect(userMessage);
      if (fams.length === 0 && personId && kv) {
        const histForFam = await getHistory(kv, personId);
        const recentAsst = [...histForFam].reverse().filter((h) => h.role === "assistant").slice(0, 2);
        for (const t of recentAsst) {
          fams = familyDetect(t.content);
          if (fams.length > 0) break;
        }
      }
      if (fams.length > 0) {
        let famCtx = "## PRODUCT SPECS (from specs.json \u2014 AUTHORITATIVE, family-level fallback)\n";
        famCtx += "Use ONLY these specs. Do NOT supplement with training data. If the exact spec the user asked about is not listed, say so and offer to pull the live datasheet.\n";
        famCtx += 'FORMATTING: Webex does NOT render pipe-delimited markdown tables ("| col | col |") \u2014 they show as literal pipes. For multi-model comparisons use grouped bullets under a bolded model header, not tables.\n\n';
        for (const fam of fams) {
          const famData = specs[fam];
          if (famData) {
            for (const [model, mSpecs] of Object.entries(famData)) {
              if (model.startsWith("_")) continue;
              famCtx += `${model}: ${JSON.stringify(mSpecs)}
`;
            }
          }
        }
        systemPrompt += "\n\n" + famCtx;
        sources.categoryFamilies.push(...fams);
        showFooter = true;
      }
    }
    const history = personId ? await getHistory(kv, personId) : [];
    const pricingIntent = /\b(COSTS?|PRICES?|PRICING|HOW MUCH|TOTAL|CART TOTAL|BREAKDOWN|ESTIMATE|INCLUDE\s+(COST|COSTS|PRICE|PRICES|PRICING)|WITH\s+(COST|COSTS|PRICE|PRICES|PRICING))\b/i.test(userMessage);
    if (pricingIntent) {
      const priceContext = getRelevantPriceContext(userMessage, history);
      if (priceContext) systemPrompt += "\n\n" + priceContext;
    }
    const accessoriesContext = getAccessoriesContext(userMessage);
    if (accessoriesContext) systemPrompt += "\n\n" + accessoriesContext;
    let userContent;
    if (imageData) {
      userContent = [
        { type: "image", source: { type: "base64", media_type: imageData.mediaType, data: imageData.base64 } },
        { type: "text", text: userMessage || "Please analyze this image." }
      ];
    } else {
      userContent = userMessage;
    }
    const messages = [...history, { role: "user", content: userContent }];
    const apiBody = {
      model: "claude-sonnet-4-6",
      max_tokens: imageData ? 4096 : 1024,
      system: systemPrompt,
      messages,
      tools: [QUOTE_URL_TOOL]
    };
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(apiBody)
    });
    if (!response.ok) {
      const errBody = await response.text();
      console.error("Anthropic API error:", response.status, errBody);
      return `Sorry, I couldn't process that request. Try a specific SKU like "quote 10 MR44".`;
    }
    let data = await response.json();
    if (imageData && data.stop_reason === "tool_use") {
      for (const msg of messages) {
        if (msg.role === "user" && Array.isArray(msg.content)) {
          msg.content = msg.content.map(
            (block) => block.type === "image" ? { type: "text", text: "[Image already analyzed in first turn]" } : block
          );
        }
      }
    }
    let accumulatedText = "";
    let toolIterations = 0;
    const toolUrls = [];
    while (data.stop_reason === "tool_use" && toolIterations < 16) {
      toolIterations++;
      for (const block of data.content) {
        if (block.type === "text" && block.text) {
          accumulatedText += block.text + "\n\n";
        }
      }
      const toolUseBlocks = data.content.filter((b) => b.type === "tool_use");
      if (toolUseBlocks.length === 0) break;
      const toolResults = [];
      for (const toolUse of toolUseBlocks) {
        if (toolUse.name === "build_quote_url") {
          let result;
          try {
            console.log(`[WEBEX] Tool input: ${JSON.stringify(toolUse.input).substring(0, 500)}`);
            result = handleQuoteUrlTool(toolUse.input);
            console.log(`[WEBEX] Tool call: build_quote_url \u2192 ${result.url?.substring(0, 80)}...`);
          } catch (toolErr) {
            console.error(`[WEBEX] Tool error: ${toolErr.message}`, toolErr.stack);
            result = { error: toolErr.message, url: null };
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify(result)
          });
          if (result.url) {
            toolUrls.push({ url: result.url, label: result.label || "Quote URL" });
          }
        } else {
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify({ error: "Unknown tool" }),
            is_error: true
          });
        }
      }
      messages.push({ role: "assistant", content: data.content });
      messages.push({ role: "user", content: toolResults });
      const nextResponse = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({ ...apiBody, messages })
      });
      if (!nextResponse.ok) break;
      data = await nextResponse.json();
    }
    const finalTextBlock = data.content?.find((b) => b.type === "text");
    if (finalTextBlock?.text) {
      accumulatedText += finalTextBlock.text;
    }
    if (toolUrls.length > 0) {
      const missingUrls = toolUrls.filter(({ url }) => !accumulatedText.includes(url));
      if (missingUrls.length > 0) {
        const fallbackBlock = missingUrls.map(
          ({ url, label }) => `**${label}:** ${url}`
        ).join("\n\n");
        accumulatedText = fallbackBlock + "\n\n" + accumulatedText;
      }
    }
    let reply = accumulatedText.replace(/\n{3,}/g, "\n\n").trim() || "Sorry, I could not generate a response.";
    reply = reply.replace(
      /(?:^|\n)((?:\|[^\n]*\|\s*\n){2,})/g,
      (match, block) => {
        const lines = block.trim().split("\n").map((l) => l.trim());
        const rows = lines.map((l) => l.replace(/^\||\|$/g, "").split("|").map((c) => c.trim())).filter((cells) => cells.length >= 2);
        if (rows.length < 2) return match;
        const dataRows = rows.filter((r) => !r.every((c) => /^-+$/.test(c) || c === ""));
        if (dataRows.length === 0) return match;
        const header = dataRows[0];
        const body = dataRows.slice(1);
        const bullets = body.map((r) => `\u2022 ${r.map((c, i) => header[i] ? `**${header[i]}:** ${c}` : c).join(" \xB7 ")}`);
        return "\n\n" + bullets.join("\n") + "\n";
      }
    );
    let sourceFooter = "";
    if (showFooter) {
      if (sources.liveModels.length > 0) {
        const uniqModels = [...new Set(sources.liveModels)];
        sourceFooter = `_\u{1F4C4} Source: live datasheet \u2014 ${uniqModels.join(", ")} (documentation.meraki.com)_`;
      } else if (sources.cachedModels.length > 0) {
        const uniqModels = [...new Set(sources.cachedModels)];
        const fetchNote = sources.fetchFailed ? " \xB7 live fetch failed, fell back to cache" : "";
        sourceFooter = `_\u{1F4CA} Source: cached specs.json \u2014 ${uniqModels.join(", ")}${fetchNote}_`;
      } else if (sources.categoryFamilies.length > 0) {
        const uniqFams = [...new Set(sources.categoryFamilies)];
        sourceFooter = `_\u{1F4CA} Source: cached specs.json \u2014 family-level (${uniqFams.join(", ")})_`;
      } else {
        sourceFooter = `_\u{1F4DA} Source: general Cisco/Meraki knowledge \u2014 ask me to "pull the datasheet" for live specs on a specific model._`;
      }
    }
    const claudeSec = ((Date.now() - claudeStartMs) / 1e3).toFixed(1);
    const modelMarker = `_\u{1F48E} Claude Sonnet 4.6 \xB7 ${claudeSec}s_`;
    const stripEmptyOrderUrls = /* @__PURE__ */ __name((s) => String(s || "").split("\n").filter((line) => !/stratusinfosystems\.com\/order\/\?item=&qty=/.test(line)).join("\n").replace(/\n{3,}/g, "\n\n"), "stripEmptyOrderUrls");
    const sanitizedReply = sanitizeLiveFetchRetryWording(swapEolUrlsInText(stripEmptyOrderUrls(reply)));
    const dedupedReply = stripEchoedSourceFooter(sanitizedReply);
    const finalReply = sourceFooter ? `${dedupedReply}

${sourceFooter}

${modelMarker}` : `${dedupedReply}

${modelMarker}`;
    if (personId) {
      await addToHistory(kv, personId, "user", userMessage);
      await addToHistory(kv, personId, "assistant", finalReply);
    }
    if (data?.usage) {
      const MODEL_COST = { input: 3, output: 15 };
      const costUsd = (data.usage.input_tokens || 0) / 1e6 * MODEL_COST.input + (data.usage.output_tokens || 0) / 1e6 * MODEL_COST.output;
      const logPromise = logBotUsageToD1(env, {
        personId,
        requestText: userMessage,
        responsePath: "claude",
        model: "claude-sonnet-4-6",
        inputTokens: data.usage.input_tokens || 0,
        outputTokens: data.usage.output_tokens || 0,
        costUsd,
        durationMs: null,
        responseText: finalReply
      }).catch(() => {
      });
      if (ctx && ctx.waitUntil) {
        ctx.waitUntil(logPromise);
      }
    }
    return finalReply;
  } catch (err) {
    console.error("Claude API error:", err.message, err.stack);
    return `Sorry, I couldn't process that request. Try a specific SKU like "quote 10 MR44" or "5 MS150-48LP-4G".`;
  }
}
__name(askClaude, "askClaude");
var index_default = {
  async fetch(request, env, ctx) {
    if (env && env.ANTHROPIC_GATEWAY_URL) ANTHROPIC_API_URL = env.ANTHROPIC_GATEWAY_URL;
    await loadLivePrices(env);
    const url = new URL(request.url);
    const WORKER_MANIFEST = {
      worker: "webex",
      version: "2.0.0-cf",
      deployedAt: (/* @__PURE__ */ new Date()).toISOString(),
      routes: ["POST /webhook", "GET /health"],
      handlers: [
        { id: "wx-trigger", name: "Webex Webhook", type: "trigger", fn: "fetch()" },
        { id: "wx-dedup", name: "Dedup Check", type: "decision", fn: "kv.get(dedup_)" },
        { id: "wx-botcheck", name: "Bot Self-Check", type: "decision", fn: "getBotPersonId()" },
        { id: "wx-getmsg", name: "Get Message", type: "api", fn: "getMessage()" },
        { id: "wx-image", name: "Image Check", type: "decision", fn: "msg.files" },
        { id: "wx-cfvision", name: "CF Vision (Llama 4 Scout)", type: "api", fn: "askCFVision()" },
        { id: "wx-imgclaude", name: "Claude Vision (fallback)", type: "api", fn: "askClaude(imageData)" },
        { id: "wx-eol", name: "EOL Lookup", type: "action", fn: "handleEolDateRequest()" },
        { id: "wx-confirm", name: "Quote Confirm", type: "action", fn: "handleQuoteConfirmation()" },
        { id: "wx-pricing", name: "Pricing Calculator", type: "action", fn: "handlePricingRequest()" },
        { id: "wx-parse", name: "parseMessage", type: "action", fn: "parseMessage()" },
        { id: "wx-clarify", name: "Clarification", type: "decision", fn: "clarification prompt" },
        { id: "wx-cfclassify", name: "CF Intent Classifier", type: "api", fn: "classifyWithCF()" },
        { id: "wx-build", name: "Build Quote", type: "action", fn: "buildQuoteResponse()" },
        { id: "wx-revision", name: "Revision Check", type: "decision", fn: "revision detection" },
        { id: "wx-claude", name: "Claude Fallback", type: "api", fn: "askClaude()" },
        { id: "wx-send", name: "Send Response", type: "output", fn: "sendMessage()" },
        { id: "wx-history", name: "Update History", type: "storage", fn: "addToHistory()" },
        { id: "wx-d1", name: "D1 + Analytics", type: "storage", fn: "ANALYTICS_DB + BOT_METRICS" }
      ],
      bindings: { kv: "CONVERSATION_KV", d1: "ANALYTICS_DB", ae: "BOT_METRICS", ai: "AI_GATEWAY" }
    };
    if (!globalThis.__manifestWritten) {
      globalThis.__manifestWritten = true;
      ctx.waitUntil((async () => {
        try {
          await env.CONVERSATION_KV.put("dashboard_manifest_webex", JSON.stringify(WORKER_MANIFEST), { expirationTtl: 86400 });
        } catch (e) {
          console.warn("Manifest write failed:", e.message);
        }
      })());
    }
    const DASH_CORS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Dashboard-Key" };
    if (url.pathname.startsWith("/dashboard/")) {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: DASH_CORS });
      const dashKey = request.headers.get("X-Dashboard-Key");
      if (!env.DASHBOARD_KEY || dashKey !== env.DASHBOARD_KEY) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: DASH_CORS });
      const db = env.ANALYTICS_DB;
      if (request.method === "GET" && url.pathname === "/dashboard/stats") {
        if (!db) return new Response(JSON.stringify({ error: "D1 not bound", usage: { total: 0 }, quotes: { total: 0 }, errors: { total: 0 }, pathBreakdown: [], modelBreakdown: [], hourly: [], recentErrors: [] }), { headers: DASH_CORS });
        try {
          const range = url.searchParams.get("range") || "24h";
          const rs = { "1h": "-1 hour", "6h": "-6 hours", "24h": "-1 day", "7d": "-7 days", "30d": "-30 days", "all": "-100 years" }[range] || "-1 day";
          const since = `datetime('now','${rs}')`;
          const [usage, quotes, errors, pathBreakdown, modelBreakdown, hourly, recentErrors] = await Promise.all([
            env.ANALYTICS_DB.prepare(`SELECT COUNT(*) as total,COALESCE(SUM(input_tokens),0) as input_tokens,COALESCE(SUM(output_tokens),0) as output_tokens,COALESCE(SUM(cost_usd),0) as total_cost,COALESCE(AVG(duration_ms),0) as avg_duration FROM bot_usage WHERE created_at >= ${since}`).first(),
            env.ANALYTICS_DB.prepare(`SELECT COUNT(*) as total,COALESCE(SUM(total_list),0) as total_list,COALESCE(SUM(total_ecomm),0) as total_ecomm FROM quote_history WHERE created_at >= ${since}`).first(),
            env.ANALYTICS_DB.prepare(`SELECT COUNT(*) as total FROM bot_usage WHERE response_path='error' AND created_at >= ${since}`).first(),
            env.ANALYTICS_DB.prepare(`SELECT response_path,COUNT(*) as count FROM bot_usage WHERE created_at >= ${since} GROUP BY response_path ORDER BY count DESC`).all(),
            env.ANALYTICS_DB.prepare(`SELECT model,COUNT(*) as count,COALESCE(SUM(input_tokens),0) as input_tokens,COALESCE(SUM(output_tokens),0) as output_tokens,COALESCE(SUM(cost_usd),0) as cost FROM bot_usage WHERE model IS NOT NULL AND created_at >= ${since} GROUP BY model ORDER BY count DESC`).all(),
            env.ANALYTICS_DB.prepare(`SELECT strftime('%Y-%m-%dT%H:00:00Z',created_at) as hour,COUNT(*) as count,SUM(CASE WHEN response_path='error' THEN 1 ELSE 0 END) as errors FROM bot_usage WHERE created_at >= ${since} GROUP BY hour ORDER BY hour`).all(),
            env.ANALYTICS_DB.prepare(`SELECT created_at,bot,response_path,error_message,duration_ms FROM bot_usage WHERE response_path='error' AND created_at >= ${since} ORDER BY created_at DESC LIMIT 20`).all()
          ]);
          return new Response(JSON.stringify({ range, timestamp: (/* @__PURE__ */ new Date()).toISOString(), usage, quotes, errors, pathBreakdown: pathBreakdown.results, modelBreakdown: modelBreakdown.results, hourly: hourly.results, recentErrors: recentErrors.results }), { headers: DASH_CORS });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: DASH_CORS });
        }
      }
      if (request.method === "GET" && url.pathname === "/dashboard/events") {
        if (!db) return new Response(JSON.stringify({ events: [], quotes: [] }), { headers: DASH_CORS });
        try {
          const since = url.searchParams.get("since") || new Date(Date.now() - 3e5).toISOString();
          const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
          const [events, quotes] = await Promise.all([
            env.ANALYTICS_DB.prepare("SELECT id,created_at,bot,response_path,model,input_tokens,output_tokens,cost_usd,duration_ms,error_message FROM bot_usage WHERE created_at > ? ORDER BY created_at DESC LIMIT ?").bind(since, limit).all(),
            env.ANALYTICS_DB.prepare("SELECT id,created_at,bot,skus,total_list,total_ecomm,response_type,eol_warnings,duration_ms FROM quote_history WHERE created_at > ? ORDER BY created_at DESC LIMIT ?").bind(since, limit).all()
          ]);
          return new Response(JSON.stringify({ events: events.results, quotes: quotes.results, timestamp: (/* @__PURE__ */ new Date()).toISOString() }), { headers: DASH_CORS });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: DASH_CORS });
        }
      }
      if (request.method === "GET" && url.pathname === "/dashboard/crm-stats") {
        if (!db) return new Response(JSON.stringify({ operations: { total: 0, errors: 0 }, breakdown: [] }), { headers: DASH_CORS });
        try {
          const range = url.searchParams.get("range") || "24h";
          const rs = { "1h": "-1 hour", "6h": "-6 hours", "24h": "-1 day", "7d": "-7 days", "30d": "-30 days", "all": "-100 years" }[range] || "-1 day";
          const since = `datetime('now','${rs}')`;
          const [ops, breakdown] = await Promise.all([
            env.ANALYTICS_DB.prepare(`SELECT COUNT(*) as total,SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) as success,SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) as errors FROM crm_operations WHERE created_at >= ${since}`).first(),
            env.ANALYTICS_DB.prepare(`SELECT operation,module,COUNT(*) as count FROM crm_operations WHERE created_at >= ${since} GROUP BY operation,module ORDER BY count DESC LIMIT 20`).all()
          ]);
          return new Response(JSON.stringify({ operations: ops, breakdown: breakdown.results }), { headers: DASH_CORS });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: DASH_CORS });
        }
      }
      if (request.method === "GET" && url.pathname === "/dashboard/pricing-status") {
        try {
          const kv = env.CONVERSATION_KV;
          const result = kv ? await kv.get("prices_live", "json") : null;
          const error = kv ? await kv.get("prices_live_error", "json") : null;
          const recentChanges = env.ANALYTICS_DB ? await env.ANALYTICS_DB.prepare("SELECT sku,old_price,new_price,list_price,price_change,change_pct,refreshed_at FROM pricing_history WHERE price_change != 0 ORDER BY refreshed_at DESC LIMIT 20").all() : { results: [] };
          return new Response(JSON.stringify({ hasLivePrices: !!result, refreshedAt: result?.refreshedAt || null, stats: result?.stats || null, lastError: error || null, recentChanges: recentChanges.results }), { headers: DASH_CORS });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: DASH_CORS });
        }
      }
      if (request.method === "GET" && url.pathname === "/dashboard/config") {
        try {
          const kv = env.CONVERSATION_KV;
          const [webex, gchat] = await Promise.all([
            kv.get("dashboard_manifest_webex", "json"),
            kv.get("dashboard_manifest_gchat", "json")
          ]);
          return new Response(JSON.stringify({ webex, gchat, timestamp: (/* @__PURE__ */ new Date()).toISOString() }), { headers: DASH_CORS });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: DASH_CORS });
        }
      }
      if (request.method === "GET" && url.pathname === "/dashboard/shadow-classifier") {
        if (!db) return new Response(JSON.stringify({ error: "D1 not bound" }), { status: 500, headers: DASH_CORS });
        try {
          const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 500);
          const [rows, stats] = await Promise.all([
            db.prepare("SELECT id, created_at, substr(request_text,1,120) as req, legacy_intent, v2_intent, v2_confidence, intent_agree, v2_items, v2_modifiers, v2_revision, v2_reference, v2_parse_error, v2_elapsed_ms, legacy_elapsed_ms, gemma4_intent, gemma4_confidence, gemma4_elapsed_ms, gemma4_items, gemma4_modifiers, gemma4_revision, gemma4_reference, gemma4_parse_error, gemma4_agree FROM classifier_shadow ORDER BY id DESC LIMIT ?").bind(limit).all(),
            db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN intent_agree=1 THEN 1 ELSE 0 END) as v2_agree, SUM(CASE WHEN gemma4_agree=1 THEN 1 ELSE 0 END) as gemma4_agree, SUM(CASE WHEN v2_parse_error IS NOT NULL THEN 1 ELSE 0 END) as v2_parse_fail, SUM(CASE WHEN gemma4_parse_error IS NOT NULL THEN 1 ELSE 0 END) as gemma4_parse_fail, AVG(legacy_elapsed_ms) as avg_legacy_ms, AVG(v2_elapsed_ms) as avg_v2_ms, AVG(gemma4_elapsed_ms) as avg_gemma4_ms FROM classifier_shadow WHERE created_at >= datetime('now','-7 days')").first()
          ]);
          return new Response(JSON.stringify({ stats, rows: rows.results || [] }, null, 2), { headers: DASH_CORS });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: DASH_CORS });
        }
      }
      if (request.method === "GET" && url.pathname === "/dashboard/traces") {
        if (!db) return new Response(JSON.stringify({ traces: [] }), { headers: DASH_CORS });
        try {
          await ensureTraceTable(db);
          const sinceRaw = url.searchParams.get("since") || new Date(Date.now() - 12e4).toISOString();
          const since = sinceRaw.replace("T", " ").replace(/\.\d+Z$/, "").replace("Z", "");
          const rows = await db.prepare(
            `SELECT trace_id, bot, node_id, status, ts_ms, metadata, created_at
             FROM workflow_traces WHERE created_at > ? ORDER BY created_at DESC, ts_ms ASC, id ASC LIMIT 500`
          ).bind(since).all();
          const grouped = {};
          for (const r of rows.results) {
            if (!grouped[r.trace_id]) grouped[r.trace_id] = { traceId: r.trace_id, bot: r.bot, createdAt: r.created_at, steps: [] };
            grouped[r.trace_id].steps.push({ nodeId: r.node_id, status: r.status, tsMs: r.ts_ms, meta: r.metadata ? JSON.parse(r.metadata) : null });
          }
          return new Response(JSON.stringify({ traces: Object.values(grouped), timestamp: (/* @__PURE__ */ new Date()).toISOString() }), { headers: DASH_CORS });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: DASH_CORS });
        }
      }
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: DASH_CORS });
    }
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return new Response(JSON.stringify({ status: "Stratus AI running", version: "2.0.0-cf", runtime: "cloudflare-workers" }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    if (request.method === "POST" && url.pathname === "/webhook") {
      const body = await request.json();
      ctx.waitUntil((async () => {
        const T = createTracer(env, "webex");
        try {
          const event = body;
          if (event.resource !== "messages" || event.event !== "created") return;
          T.step("wx-trigger", "enter", { msgId: event.data?.id });
          const token = env.WEBEX_BOT_TOKEN;
          const kv = env.CONVERSATION_KV;
          T.step("wx-dedup", "enter");
          const msgId = event.data?.id;
          if (msgId && kv) {
            const dedupKey = `dedup_${msgId}`;
            const already = await kv.get(dedupKey);
            if (already) {
              console.log(`[WEBEX] Dedup: skipping already-processed message ${msgId}`);
              T.step("wx-dedup", "exit", { result: "duplicate" });
              ctx.waitUntil(T.flush());
              return;
            }
            await kv.put(dedupKey, "1", { expirationTtl: 300 });
          }
          T.step("wx-dedup", "exit", { result: "new" });
          T.step("wx-botcheck", "enter");
          const botId = await getBotPersonId(token);
          const personId = event.data.personId;
          if (personId === botId) {
            T.step("wx-botcheck", "exit", { result: "is_bot" });
            ctx.waitUntil(T.flush());
            return;
          }
          T.step("wx-botcheck", "exit", { result: "not_bot" });
          T.step("wx-getmsg", "enter");
          const msg = await getMessage(event.data.id, token);
          let text;
          if (msg.html) {
            text = msg.html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
          } else {
            text = (msg.text || "").trim();
          }
          const roomId = msg.roomId;
          T.step("wx-getmsg", "exit");
          T.step("wx-image", "enter");
          if (msg.files && msg.files.length > 0) {
            const fileUrl = msg.files[0];
            const imageData = await downloadWebexFile(fileUrl, token);
            if (imageData && imageData.mediaType.startsWith("image/")) {
              T.step("wx-image", "exit", { result: "has_image" });
              const _basePrompt = getDashboardVisionPrompt();
              const _userCaption = (text || "").trim();
              const prompt = _userCaption ? `${_basePrompt}

User also wrote: "${_userCaption}"
Respond with the LICENSE_DASHBOARD_PARSE_V1 block first; you may add additional notes after the block if relevant to the user's note.` : _basePrompt;
              T.step("wx-cfvision", "enter");
              let cfVision = await askCFVision(prompt, imageData, env);
              T.step("wx-cfvision", "exit");
              if (cfVision && cfVision.response && shouldAuditDashboardVision(cfVision.response)) {
                T.step("wx-cfvision-audit", "enter");
                console.log("[CF-Vision] First pass suspicious, running audit pass");
                const auditPrompt = getDashboardVisionAuditPrompt(cfVision.response);
                const audit = await askCFVision(auditPrompt, imageData, env);
                T.step("wx-cfvision-audit", "exit", { ran: !!audit });
                if (audit && audit.response) {
                  const firstSkus = extractSkusFromVisionText(cfVision.response);
                  const auditSkus = extractSkusFromVisionText(audit.response);
                  const merged = mergeVisionSkusMax(firstSkus, auditSkus);
                  const tail = cfVision.response.split(/\n---\n/).slice(2).join("\n---\n");
                  const skuLines = merged.map((s) => `SKU: ${s.sku} | LIMIT: ${s.qty} | ACTIVE: ${s.qty}`).join("\n");
                  cfVision = {
                    ...cfVision,
                    response: `LICENSE_DASHBOARD_PARSE_V1
---
${skuLines}
---${tail ? "\n" + tail : ""}`,
                    elapsed: cfVision.elapsed + audit.elapsed,
                    audited: true
                  };
                  console.log(`[CF-Vision] Audit merge: first=${firstSkus.length} audit=${auditSkus.length} merged=${merged.length}`);
                }
              }
              if (cfVision) {
                const visionSkus = extractSkusFromVisionText(cfVision.response);
                const _dashMeta = extractDashboardMetadata(cfVision.response || "");
                if (visionSkus.length > 0) {
                  await kv.put(`vision_skus_${personId}`, JSON.stringify({ skus: visionSkus, mxEdition: _dashMeta.mxEdition, mrEdition: _dashMeta.mrEdition }), { expirationTtl: 300 });
                  console.log(`[CF-Vision] Extracted ${visionSkus.length} SKUs from vision, stored in KV for 5min`);
                }
                await addToHistory(kv, personId, "user", `[Image] ${prompt}`);
                if (visionSkus.length > 0) {
                  const skuSummary = visionSkus.map((s) => `**${s.sku}** \xD7 ${s.qty}`).join("\n");
                  const dashQuote = buildDashboardRenewalQuote(visionSkus, {
                    mxEdition: _dashMeta.mxEdition,
                    mrEdition: _dashMeta.mrEdition
                  });
                  if (dashQuote && dashQuote.message) {
                    const qmsg = dashQuote.message || "";
                    const droppedFlags = [];
                    for (const s of visionSkus) {
                      const upper = s.sku.toUpperCase();
                      if (upper.startsWith("LIC-") && !licenseTermSiblings(upper)) continue;
                      let seen = false;
                      if (upper === "MR-ENT" || upper === "MR_ENT") {
                        seen = /\bLIC-ENT-[135]YR?\b/.test(qmsg);
                      } else if (upper === "SM-ENT" || upper === "SM_ENT" || upper === "SME" || upper === "SM") {
                        seen = /\bLIC-(?:SME|MI-EMSC-D-1YMC-A)-[135]YR?\b/.test(qmsg);
                      } else {
                        const escaped = upper.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                        const directRe = new RegExp(`\\b${escaped}\\b`);
                        const licRe = new RegExp(`LIC-${escaped}(?:-[A-Z0-9]+)?-[135]Y`);
                        seen = directRe.test(qmsg) || licRe.test(qmsg);
                      }
                      if (!seen) droppedFlags.push(`\u26A0\uFE0F **${s.sku}** \xD7 ${s.qty} was detected but did not appear in the quote \u2014 manual review needed.`);
                    }
                    const dropBlock = droppedFlags.length > 0 ? `

${droppedFlags.join("\n")}` : "";
                    if (droppedFlags.length > 0) {
                      console.warn(`[CF-Vision] ${droppedFlags.length} SKU(s) dropped from final quote:`, droppedFlags);
                    }
                    const combined = `**Detected SKUs:**
${skuSummary}${dropBlock}

---

${dashQuote.message}`;
                    await addToHistory(kv, personId, "assistant", combined);
                    T.step("wx-send", "enter");
                    await sendMessage(roomId, `${combined}

_\u26A1 Workers AI Vision + License Renewal (${cfVision.elapsed}ms, free)_`, token);
                    T.step("wx-send", "exit");
                    T.step("wx-d1", "enter");
                    logBotUsageToD1(env, { personId, requestText: `[Image] ${prompt}`, responsePath: "cf-vision-quote", durationMs: cfVision.elapsed, responseText: combined }).catch(() => {
                    });
                    writeMetric(env, { path: "cf-vision-quote", durationMs: cfVision.elapsed, personId });
                    T.step("wx-d1", "exit");
                    ctx.waitUntil(T.flush());
                    return;
                  }
                  const summaryTail = `

\u26A0\uFE0F I detected these SKUs but couldn't auto-build a renewal quote. Reply **"quote that"** and I'll put the options together, or double-check the SKUs above.`;
                  const summaryMsg = `**Detected SKUs:**
${skuSummary}${summaryTail}`;
                  await addToHistory(kv, personId, "assistant", summaryMsg);
                  T.step("wx-send", "enter");
                  await sendMessage(roomId, `${summaryMsg}

_\u26A1 Workers AI Vision (${cfVision.elapsed}ms, free)_`, token);
                  T.step("wx-send", "exit");
                  T.step("wx-d1", "enter");
                  logBotUsageToD1(env, { personId, requestText: `[Image] ${prompt}`, responsePath: "cf-vision", durationMs: cfVision.elapsed, responseText: summaryMsg }).catch(() => {
                  });
                  writeMetric(env, { path: "cf-vision", durationMs: cfVision.elapsed, personId });
                  T.step("wx-d1", "exit");
                  ctx.waitUntil(T.flush());
                  return;
                }
                await addToHistory(kv, personId, "assistant", cfVision.response);
                T.step("wx-send", "enter");
                await sendMessage(roomId, `${cfVision.response}

_\u26A1 Workers AI Vision (${cfVision.elapsed}ms, free)_`, token);
                T.step("wx-send", "exit");
                T.step("wx-d1", "enter");
                logBotUsageToD1(env, { personId, requestText: `[Image] ${prompt}`, responsePath: "cf-vision", durationMs: cfVision.elapsed, responseText: cfVision.response }).catch(() => {
                });
                writeMetric(env, { path: "cf-vision", durationMs: cfVision.elapsed, personId });
                T.step("wx-d1", "exit");
                ctx.waitUntil(T.flush());
                return;
              }
              console.log("[Routing] CF vision failed, falling back to Claude");
              T.step("wx-imgclaude", "enter");
              const claudeReply2 = await askClaude(prompt, personId, env, imageData, null, ctx);
              T.step("wx-imgclaude", "exit");
              T.step("wx-send", "enter");
              await sendMessage(roomId, claudeReply2, token);
              T.step("wx-send", "exit");
              ctx.waitUntil(T.flush());
              return;
            }
            if (msg.files.length > 0) {
              if (text) {
              } else {
                T.step("wx-image", "exit", { result: "file_failed" });
                T.step("wx-send", "enter");
                await sendMessage(roomId, `I received a file attachment but couldn't process it as an image. Could you try sending it again?`, token);
                T.step("wx-send", "exit");
                ctx.waitUntil(T.flush());
                return;
              }
            }
          }
          T.step("wx-image", "exit", { result: "text_only" });
          if (!text) {
            ctx.waitUntil(T.flush());
            return;
          }
          const _wxStartMs = Date.now();
          T.step("wx-eol", "enter");
          const eolDateReply = handleEolDateRequest(text);
          if (eolDateReply) {
            T.step("wx-eol", "exit", { result: "match" });
            await addToHistory(kv, personId, "user", text);
            await addToHistory(kv, personId, "assistant", eolDateReply);
            T.step("wx-history", "enter");
            T.step("wx-history", "exit");
            T.step("wx-send", "enter");
            await sendMessage(roomId, eolDateReply, token);
            T.step("wx-send", "exit");
            T.step("wx-d1", "enter");
            ctx.waitUntil(logBotUsageToD1(env, { personId, requestText: text, responsePath: "eol-date", durationMs: Date.now() - _wxStartMs, responseText: eolDateReply }).catch(() => {
            }));
            writeMetric(env, { path: "eol-date", durationMs: Date.now() - _wxStartMs, personId });
            T.step("wx-d1", "exit");
            ctx.waitUntil(T.flush());
            return;
          }
          T.step("wx-eol", "exit", { result: "no_match" });
          T.step("wx-confirm", "enter");
          const quoteConfirmReply = await handleQuoteConfirmation(text, personId, kv);
          if (quoteConfirmReply) {
            T.step("wx-confirm", "exit", { result: "confirmed" });
            await addToHistory(kv, personId, "user", text);
            await addToHistory(kv, personId, "assistant", quoteConfirmReply);
            T.step("wx-history", "enter");
            T.step("wx-history", "exit");
            T.step("wx-send", "enter");
            await sendMessage(roomId, quoteConfirmReply, token);
            T.step("wx-send", "exit");
            T.step("wx-d1", "enter");
            ctx.waitUntil(logBotUsageToD1(env, { personId, requestText: text, responsePath: "quote-confirmation", durationMs: Date.now() - _wxStartMs, responseText: quoteConfirmReply }).catch(() => {
            }));
            writeMetric(env, { path: "quote-confirmation", durationMs: Date.now() - _wxStartMs, personId });
            T.step("wx-d1", "exit");
            ctx.waitUntil(T.flush());
            return;
          }
          T.step("wx-confirm", "exit", { result: "no" });
          T.step("wx-followup", "enter");
          try {
            const followUpReply = await handleFollowUpModifier(text, personId, kv);
            if (followUpReply) {
              T.step("wx-followup", "exit", { result: "match" });
              await addToHistory(kv, personId, "user", text);
              await addToHistory(kv, personId, "assistant", followUpReply);
              T.step("wx-send", "enter");
              await sendMessage(roomId, `${followUpReply}

_\u26A1 Follow-up modifier (deterministic, free)_`, token);
              T.step("wx-send", "exit");
              T.step("wx-d1", "enter");
              logBotUsageToD1(env, { personId, requestText: text, responsePath: "followup-modifier", durationMs: Date.now() - _wxStartMs, responseText: followUpReply }).catch(() => {
              });
              writeMetric(env, { path: "followup-modifier", durationMs: Date.now() - _wxStartMs, personId });
              T.step("wx-d1", "exit");
              ctx.waitUntil(T.flush());
              return;
            }
            T.step("wx-followup", "exit", { result: "no_match" });
          } catch (e) {
            console.warn("[FollowUp] error:", e.message);
            T.step("wx-followup", "exit", { result: "error" });
          }
          T.step("wx-tiercont", "enter");
          try {
            const _histTier = await getHistory(kv, personId);
            const _lastAsstTier = (_histTier || []).filter((h) => h.role === "assistant").slice(-1)[0];
            const _tierRequest = _lastAsstTier ? buildTierClarifyContinuation(text, _lastAsstTier.content) : null;
            if (_tierRequest) {
              const _tierParsed = parseMessage(_tierRequest);
              const _tierResult = _tierParsed ? buildQuoteResponse(_tierParsed) : null;
              if (_tierResult && _tierResult.message && !_tierResult.needsLlm) {
                T.step("wx-tiercont", "exit", { result: "match" });
                await addToHistory(kv, personId, "user", text);
                await addToHistory(kv, personId, "assistant", _tierResult.message);
                T.step("wx-send", "enter");
                await sendMessage(roomId, _tierResult.message, token);
                T.step("wx-send", "exit");
                T.step("wx-d1", "enter");
                ctx.waitUntil(logBotUsageToD1(env, { personId, requestText: text, responsePath: "tier-continuation", durationMs: Date.now() - _wxStartMs, responseText: _tierResult.message }).catch(() => {
                }));
                writeMetric(env, { path: "tier-continuation", durationMs: Date.now() - _wxStartMs, personId });
                T.step("wx-d1", "exit");
                ctx.waitUntil(T.flush());
                return;
              }
            }
            T.step("wx-tiercont", "exit", { result: "no_match" });
          } catch (e) {
            console.warn("[TierCont] error:", e.message);
            T.step("wx-tiercont", "exit", { result: "error" });
          }
          T.step("wx-flag", "enter");
          const isFlagPhrase = /^\s*(?:please\s+)?(?:flag|mark|report|note)(?:\s+(?:it|this|that|the\s+(?:last|previous|prior)\s+(?:answer|reply|response|message)?))?\s*\.?\s*$/i.test(text);
          if (isFlagPhrase) {
            try {
              const histForFlag = await getHistory(kv, personId);
              const lastAsst = (histForFlag || []).filter((h) => h.role === "assistant").slice(-1)[0];
              const flaggedPreview = lastAsst ? String(lastAsst.content || "").substring(0, 400) : "(no prior assistant message)";
              const flagAck = "Got it - I've logged this thread for review. Anything else I can help with?";
              await addToHistory(kv, personId, "user", text);
              await addToHistory(kv, personId, "assistant", flagAck);
              T.step("wx-flag", "exit", { result: "logged" });
              T.step("wx-send", "enter");
              await sendMessage(roomId, flagAck, token);
              T.step("wx-send", "exit");
              T.step("wx-d1", "enter");
              ctx.waitUntil(logBotUsageToD1(env, {
                personId,
                requestText: text,
                responsePath: "feedback-flag",
                durationMs: Date.now() - _wxStartMs,
                responseText: flagAck,
                errorMessage: `FLAGGED: ${flaggedPreview}`
              }).catch(() => {
              }));
              writeMetric(env, { path: "feedback-flag", durationMs: Date.now() - _wxStartMs, personId });
              T.step("wx-d1", "exit");
              ctx.waitUntil(T.flush());
              return;
            } catch (e) {
              console.warn("[Flag] error:", e.message);
              T.step("wx-flag", "exit", { result: "error" });
            }
          } else {
            T.step("wx-flag", "exit", { result: "no_match" });
          }
          T.step("wx-pricing", "enter");
          const pricingReply = await handlePricingRequest(text, personId, kv);
          if (pricingReply) {
            T.step("wx-pricing", "exit", { result: "match" });
            await addToHistory(kv, personId, "user", text);
            await addToHistory(kv, personId, "assistant", pricingReply);
            T.step("wx-history", "enter");
            T.step("wx-history", "exit");
            T.step("wx-send", "enter");
            await sendMessage(roomId, pricingReply, token);
            T.step("wx-send", "exit");
            T.step("wx-d1", "enter");
            ctx.waitUntil(logBotUsageToD1(env, { personId, requestText: text, responsePath: "pricing-deterministic", durationMs: Date.now() - _wxStartMs, responseText: pricingReply }).catch(() => {
            }));
            writeMetric(env, { path: "pricing-deterministic", durationMs: Date.now() - _wxStartMs, personId });
            T.step("wx-d1", "exit");
            ctx.waitUntil(T.flush());
            return;
          }
          T.step("wx-pricing", "exit", { result: "no_match" });
          T.step("wx-preparse", "enter");
          try {
            let preParsed = parseExplicitDirectLicenseListBeforeClassifier(text) || parseExplicitSkuRequestBeforeClassifier(text);
            preParsed = preserveMsAdvancedTier(preParsed, text);
            if (preParsed && !preParsed.isRevision && !preParsed.isAdvisory) {
              if (preParsed.isClarification && preParsed.clarificationMessage) {
                T.step("wx-preparse", "exit", { result: "clarify" });
                await addToHistory(kv, personId, "user", text);
                await addToHistory(kv, personId, "assistant", preParsed.clarificationMessage);
                T.step("wx-send", "enter");
                await sendMessage(roomId, preParsed.clarificationMessage, token);
                T.step("wx-send", "exit");
                T.step("wx-d1", "enter");
                ctx.waitUntil(logBotUsageToD1(env, { personId, requestText: text, responsePath: "clarify-question", durationMs: Date.now() - _wxStartMs, responseText: preParsed.clarificationMessage }).catch(() => {
                }));
                writeMetric(env, { path: "clarify-question", durationMs: Date.now() - _wxStartMs, personId });
                T.step("wx-d1", "exit");
                ctx.waitUntil(T.flush());
                return;
              }
              if (!preParsed.isClarification) {
                const preResult = buildQuoteResponse(preParsed);
                if (preResult && preResult.message && !preResult.needsLlm && !(preResult.errors && preResult.errors.length)) {
                  T.step("wx-preparse", "exit", { result: "quoted", items: preParsed.items?.length || preParsed.directLicenseList?.length || 0 });
                  await addToHistory(kv, personId, "user", text);
                  await addToHistory(kv, personId, "assistant", preResult.message);
                  T.step("wx-send", "enter");
                  await sendMessage(roomId, `${preResult.message}

_\u26A1 Deterministic (pre-parse, free)_`, token);
                  T.step("wx-send", "exit");
                  T.step("wx-d1", "enter");
                  logBotUsageToD1(env, { personId, requestText: text, responsePath: "preparse-deterministic", durationMs: Date.now() - _wxStartMs, responseText: preResult.message }).catch(() => {
                  });
                  writeMetric(env, { path: "preparse-deterministic", durationMs: Date.now() - _wxStartMs, personId });
                  T.step("wx-d1", "exit");
                  ctx.waitUntil(T.flush());
                  return;
                }
              }
            }
          } catch (e) {
            console.warn("[PreParse] error:", e.message);
          }
          T.step("wx-preparse", "exit", { result: "no_match" });
          let priorCtxForV2 = "";
          try {
            const hist = await getHistory(kv, personId);
            const lastAsst = (hist || []).filter((h) => h.role === "assistant").slice(-1)[0];
            if (lastAsst) priorCtxForV2 = String(lastAsst.content || "").substring(0, 1500);
          } catch {
          }
          T.step("wx-cfclassify", "enter");
          let classification;
          let v2Classification = null;
          let v2RoutingClassification = null;
          let gemma4Classification = null;
          let _rollbackShadowPromise = null;
          let _v3Promise = null;
          if (USE_V2_CLASSIFIER) {
            const _v2Promise = classifyWithCFv2(text, priorCtxForV2, env).catch((e) => ({ error: e.message, parseError: true }));
            _v3Promise = String(env.CF_QUOTE_V3_ENABLED) === "true" ? classifyV3(text, "", env).catch(() => null) : null;
            const _legacyPromise = classifyWithCF(text, env).catch((e) => ({ error: e.message, intent: "escalate" }));
            [v2Classification, classification] = await Promise.all([_v2Promise, _legacyPromise]);
            const LOW_CONF_THRESHOLD = 0.7;
            const GEMMA_TIMEOUT_MS = 5e3;
            const hasPriorCtx = !!(priorCtxForV2 && String(priorCtxForV2).trim());
            v2RoutingClassification = normalizeV2ClassifierForRouting(v2Classification, text, hasPriorCtx);
            if (v2RoutingClassification?._deterministicRouting) {
              console.log(`[Waterfall] Deterministic routing normalization: ${v2Classification?.intent || "ERR"} -> ${v2RoutingClassification.intent} (${v2RoutingClassification._deterministicRouting})`);
            }
            const v2Intent = v2RoutingClassification?.intent;
            const v2ConfRaw = v2RoutingClassification?.confidence;
            const v2Conf = typeof v2ConfRaw === "number" ? v2ConfRaw : Number(v2ConfRaw) || 0;
            const v2Broken = !v2Intent || v2RoutingClassification?.parseError || v2RoutingClassification?.error;
            const v2Items = Array.isArray(v2RoutingClassification?.items) ? v2RoutingClassification.items : [];
            const deterministicHandled = !!v2RoutingClassification?._deterministicRouting;
            const structQuoteEmptyItems = v2Intent === "quote" && v2Items.length === 0;
            const structReviseNoPrior = v2Intent === "revise" && !hasPriorCtx;
            const structAmbiguousStem = v2Intent === "quote" && classifierHasAmbiguousStem(v2RoutingClassification);
            const structuralEscalate = !deterministicHandled && (structQuoteEmptyItems || structReviseNoPrior || structAmbiguousStem);
            const weakHit = !deterministicHandled && (v2Intent === "price_lookup" && hasPriorCtx || v2Intent === "clarify");
            const v2TimedOut = /TIMEOUT/i.test(String(v2Classification?.error || v2Classification?.parseError || ""));
            const escalate = (v2Broken || v2Conf < LOW_CONF_THRESHOLD || weakHit || structuralEscalate) && !v2TimedOut;
            if (v2TimedOut) {
              console.log("[Waterfall] V2 timed out \u2014 skipping Gemma escalation (same backend would also time out), routing on legacy");
            }
            if (escalate) {
              const reason = v2Broken ? "broken" : v2Conf < LOW_CONF_THRESHOLD ? `low-conf(${v2Conf})` : structQuoteEmptyItems ? "struct:quote-empty-items" : structReviseNoPrior ? "struct:revise-no-prior" : structAmbiguousStem ? "struct:ambiguous-sku-stem" : weakHit ? `weak:${v2Intent}` : "unknown";
              console.log(`[Waterfall] Escalating to Gemma 4: v2Intent=${v2Intent || "ERR"} conf=${v2Conf} reason=${reason}`);
              gemma4Classification = await Promise.race([
                classifyWithGemma4(text, priorCtxForV2, env).catch((e) => ({ error: e.message })),
                new Promise((resolve) => setTimeout(() => resolve({ timeout: true, elapsed: GEMMA_TIMEOUT_MS }), GEMMA_TIMEOUT_MS))
              ]);
              if (gemma4Classification?.timeout) {
                console.log(`[Waterfall] Gemma timed out at ${GEMMA_TIMEOUT_MS}ms, falling back to V2`);
              }
            } else {
              console.log(`[Waterfall] Skipping Gemma: V2 confident (${v2Intent} conf=${v2Conf})`);
            }
          } else {
            classification = await classifyWithCF(text, env);
            _rollbackShadowPromise = classifyWithCFv2(text, priorCtxForV2, env).catch((e) => ({ error: e.message }));
          }
          T.step("wx-cfclassify", "exit");
          ctx.waitUntil((async () => {
            try {
              let v2c, g4c;
              if (USE_V2_CLASSIFIER) {
                v2c = v2Classification;
                g4c = gemma4Classification;
              } else {
                v2c = _rollbackShadowPromise ? await _rollbackShadowPromise : null;
                g4c = null;
              }
              if (v2c) console.log(`[Shadow-V2] intent=${v2c.intent || "ERR"} conf=${v2c.confidence || "?"} (${v2c.elapsed || 0}ms)${v2c.parseError ? " parseErr=" + v2c.parseError : ""}`);
              if (g4c) console.log(`[Shadow-Gemma4] intent=${g4c.intent || "ERR"} conf=${g4c.confidence || "?"} (${g4c.elapsed || 0}ms)${g4c.parseError ? " parseErr=" + g4c.parseError : ""}${g4c.timeout ? " timeout=true" : ""}`);
              let v3c = null;
              try {
                v3c = await classifyWithV3Shadow(text, priorCtxForV2, env);
              } catch (e) {
                v3c = { error: e?.message };
              }
              if (v3c) console.log(`[Shadow-V3] intent=${v3c.intent || "ERR"} conf=${v3c.confidence || "?"} (${v3c.elapsed || 0}ms)${v3c.parseError ? " parseErr=" + v3c.parseError : ""}`);
              await logShadowClassification(env, {
                personId,
                requestText: text,
                priorContext: priorCtxForV2,
                legacy: classification,
                v2: v2c,
                gemma4: g4c,
                v3: v3c
              });
            } catch (e) {
              console.warn("[Shadow] error:", e?.message);
            }
          })());
          let activeClassification = classification;
          const v2Valid = USE_V2_CLASSIFIER && v2RoutingClassification && !v2RoutingClassification.parseError && !v2RoutingClassification.error && v2RoutingClassification.intent;
          if (v2Valid) {
            activeClassification = {
              intent: v2RoutingClassification.intent,
              reply: v2RoutingClassification.reply || "",
              extracted: v2RoutingClassification.items?.map((i) => `${i.qty || 1} ${i.sku}`).join(", ") || "",
              elapsed: v2RoutingClassification.elapsed,
              // Preserve V2 rich structure for downstream use
              _v2: v2RoutingClassification
            };
            console.log(`[V2-Active] intent=${activeClassification.intent} (V2 ${v2RoutingClassification.elapsed}ms / legacy ${classification?.elapsed}ms)`);
          } else if (USE_V2_CLASSIFIER) {
            console.log(`[V2-Fallback] V2 failed (${v2Classification?.error || v2Classification?.parseError || "null"}), using legacy classifier`);
          }
          if (!activeClassification) {
            try {
              const rescued = parseMessage(text);
              if (rescued && (rescued.items?.length || rescued.directLicenseList?.length || rescued.directLicense || rescued.isClarification)) {
                activeClassification = { intent: "quote", reply: "", extracted: "", elapsed: Date.now() - _wxStartMs, _parseRescue: true };
                console.log("[CF-Rescue] All classifiers failed; deterministic parse rescued quote routing");
              }
            } catch (e) {
              console.warn("[CF-Rescue] parse failed:", e?.message);
            }
          }
          const GEMMA_WIN_CONF = 0.8;
          const gemmaValid = gemma4Classification && !gemma4Classification.timeout && !gemma4Classification.error && !gemma4Classification.parseError && gemma4Classification.intent;
          if (gemmaValid) {
            const gemmaConfRaw = gemma4Classification.confidence;
            const gemmaConf = typeof gemmaConfRaw === "number" ? gemmaConfRaw : Number(gemmaConfRaw) || 0;
            const gemmaIntent = String(gemma4Classification.intent).toLowerCase();
            const activeIntentLower = activeClassification?.intent ? String(activeClassification.intent).toLowerCase() : null;
            const disagrees = activeIntentLower && gemmaIntent !== activeIntentLower;
            if (gemmaConf >= GEMMA_WIN_CONF && disagrees) {
              const overriddenSource = v2Valid ? "V2" : "legacy";
              console.log(`[Waterfall] Gemma overrides ${overriddenSource}: ${activeIntentLower} -> ${gemmaIntent} (gemmaConf=${gemmaConf}, gemmaMs=${gemma4Classification.elapsed})`);
              activeClassification = {
                intent: gemma4Classification.intent,
                reply: gemma4Classification.reply || "",
                extracted: gemma4Classification.items?.map((i) => `${i.qty || 1} ${i.sku}`).join(", ") || "",
                elapsed: gemma4Classification.elapsed,
                _gemma: gemma4Classification,
                _v2: v2Valid ? v2RoutingClassification : void 0
              };
            } else {
              console.log(`[Waterfall] Gemma agrees or below win threshold: gemmaIntent=${gemmaIntent} conf=${gemmaConf} (keeping ${v2Valid ? "V2" : "legacy"}: ${activeIntentLower})`);
            }
          }
          if (activeClassification) {
            console.log(`[CF-First] Intent: ${activeClassification.intent} (${activeClassification.elapsed}ms)`);
            if (activeClassification.intent === "clarify") {
              const clarifyReply = activeClassification.reply || buildClassifierClarifyReply(text, activeClassification._v2 || activeClassification._gemma || activeClassification);
              const routingTag = activeClassification._v2?._deterministicRouting || activeClassification._gemma?._deterministicRouting || activeClassification._deterministicRouting || null;
              if (!clarifyReply) {
                console.log("[CF-First] Clarify intent without usable reply, falling through");
              } else {
                await addToHistory(kv, personId, "user", text);
                await addToHistory(kv, personId, "assistant", clarifyReply);
                T.step("wx-send", "enter");
                await sendMessage(roomId, `${clarifyReply}

_\u26A1 Workers AI (${activeClassification.elapsed}ms, free)_`, token);
                T.step("wx-send", "exit");
                T.step("wx-d1", "enter");
                logBotUsageToD1(env, { personId, requestText: text, responsePath: "cf-clarify", model: routingTag, durationMs: Date.now() - _wxStartMs, responseText: clarifyReply }).catch(() => {
                });
                writeMetric(env, { path: "cf-clarify", durationMs: Date.now() - _wxStartMs, personId });
                T.step("wx-d1", "exit");
                ctx.waitUntil(T.flush());
                return;
              }
            }
            if (activeClassification.intent === "product_info") {
              console.log(`[CF-First] Product info question, routing to Claude`);
            }
            if (activeClassification.intent === "escalate") {
              console.log(`[CF-Escalate] Complex request, falling through to Claude`);
            } else if (activeClassification.intent === "conversation") {
              const isRetryPhrase = /\b(try\s+again|retry|do\s+it\s+again|please\s+(try|do|fetch|pull|retry)|you\s+(can|do)\s+(do|have|fetch|pull|browse)|that.s\s+wrong|fetch\s+it|do\s+it)\b/i.test(text);
              if (isRetryPhrase) {
                let priorWasClaude = false;
                try {
                  const histForRetry = await getHistory(kv, personId);
                  const recentAsst = (histForRetry || []).filter((h) => h.role === "assistant").slice(-2);
                  priorWasClaude = recentAsst.some((t) => {
                    const c = String(t && t.content || "");
                    return /Claude Sonnet|Live datasheet|datasheet|specs?\b|cached specs|browse|fetch/i.test(c);
                  });
                } catch (_) {
                }
                if (priorWasClaude) {
                  console.log("[CF-First] Retry phrase + prior Claude/datasheet context \u2192 reroute to Claude with history");
                  T.step("wx-claude", "enter");
                  const retryReply = await askClaude(`${text}

(Note: The user is retrying a prior datasheet or product-info turn. Use the conversation history to identify the model(s) they asked about. Treat this same turn as the retry: if '## LIVE DATASHEET CONTENT' is in your prompt, answer from it directly. If it is missing but recent history already contains a successful live datasheet answer, summarize that existing live-sourced answer. Do NOT claim you cannot browse, do NOT ask the user to 'send another message to trigger the fetch', and do NOT ask them to try one model at a time.)`, personId, env, null, activeClassification, ctx);
                  T.step("wx-claude", "exit");
                  await addToHistory(kv, personId, "user", text);
                  await addToHistory(kv, personId, "assistant", retryReply);
                  T.step("wx-send", "enter");
                  await sendMessage(roomId, retryReply, token);
                  T.step("wx-send", "exit");
                  T.step("wx-d1", "enter");
                  ctx.waitUntil(logBotUsageToD1(env, { personId, requestText: text, responsePath: "claude-retry-rerouted", durationMs: Date.now() - _wxStartMs, responseText: retryReply }).catch(() => {
                  }));
                  writeMetric(env, { path: "claude-retry-rerouted", durationMs: Date.now() - _wxStartMs, personId });
                  T.step("wx-d1", "exit");
                  ctx.waitUntil(T.flush());
                  return;
                }
              }
              const convoReply = activeClassification.reply && activeClassification.reply.length > 5 ? activeClassification.reply : (await askCFConversation(text, env))?.response;
              if (convoReply) {
                await addToHistory(kv, personId, "user", text);
                await addToHistory(kv, personId, "assistant", convoReply);
                T.step("wx-send", "enter");
                await sendMessage(roomId, `${convoReply}

_\u26A1 Workers AI (${activeClassification.elapsed}ms, free)_`, token);
                T.step("wx-send", "exit");
                T.step("wx-d1", "enter");
                logBotUsageToD1(env, { personId, requestText: text, responsePath: "cf-conversation", durationMs: Date.now() - _wxStartMs, responseText: convoReply }).catch(() => {
                });
                writeMetric(env, { path: "cf-conversation", durationMs: Date.now() - _wxStartMs, personId });
                T.step("wx-d1", "exit");
                ctx.waitUntil(T.flush());
                return;
              }
            } else if (activeClassification.intent === "quote") {
              const quoteText = activeClassification.extracted || text;
              const routingTag = activeClassification._v2?._deterministicRouting || activeClassification._gemma?._deterministicRouting || activeClassification._deterministicRouting || null;
              console.log(`[CF-First] Quote intent, executing deterministic with: ${quoteText}`);
              T.step("wx-parse", "enter");
              let quoteParsed = parseExplicitDirectLicenseListBeforeClassifier(text) || parseExplicitSkuRequestBeforeClassifier(text);
              if (_v3Promise && !quoteParsed) {
                try {
                  const _v3 = await _v3Promise;
                  if (_v3 && _v3.intent === "quote") quoteParsed = buildQuoteFromV3(_v3, text) || null;
                } catch (_) {
                  quoteParsed = null;
                }
              }
              if (!quoteParsed && activeClassification._v2) {
                try {
                  quoteParsed = buildQuoteFromV2(activeClassification._v2, text);
                  if (quoteParsed) {
                    console.log(`[CF-First] V2-direct built parseMessage-shape: ${quoteParsed.items?.length || 0} items, term=${quoteParsed.requestedTerm || "all"}, tier=${quoteParsed.requestedTier || "default"}`);
                  }
                } catch (e) {
                  console.warn(`[CF-First] V2-direct adapter failed, falling back to parseMessage: ${e?.message}`);
                  quoteParsed = null;
                }
              }
              if (!quoteParsed) quoteParsed = parseMessage(text);
              quoteParsed = preserveMsAdvancedTier(quoteParsed, text);
              if (quoteParsed) {
                T.step("wx-parse", "exit", { result: quoteParsed._fromV2 ? "v2-direct" : "parsed", items: quoteParsed.items?.length || 0, advisory: quoteParsed.isAdvisory, revision: quoteParsed.isRevision });
                if (quoteParsed.isClarification && quoteParsed.clarificationMessage) {
                  T.step("wx-clarify", "enter");
                  T.step("wx-clarify", "exit");
                  await addToHistory(kv, personId, "user", text);
                  await addToHistory(kv, personId, "assistant", quoteParsed.clarificationMessage);
                  T.step("wx-send", "enter");
                  await sendMessage(roomId, quoteParsed.clarificationMessage, token);
                  T.step("wx-send", "exit");
                  T.step("wx-d1", "enter");
                  ctx.waitUntil(logBotUsageToD1(env, { personId, requestText: text, responsePath: "clarify-question", durationMs: Date.now() - _wxStartMs, responseText: quoteParsed.clarificationMessage }).catch(() => {
                  }));
                  writeMetric(env, { path: "clarify-question", durationMs: Date.now() - _wxStartMs, personId });
                  T.step("wx-d1", "exit");
                  ctx.waitUntil(T.flush());
                  return;
                }
                if (quoteParsed.isRevision) {
                  T.step("wx-revision", "enter");
                  const history = await getHistory(kv, personId);
                  if (history.length > 0) {
                    T.step("wx-revision", "exit", { result: "has_history" });
                    T.step("wx-claude", "enter");
                    const claudeReply2 = await askClaude(`${text}

(Note: The user is modifying their previous quote request. Use the conversation history to understand what they originally asked for, apply the requested change, and generate updated URLs.)`, personId, env, null, null, ctx);
                    T.step("wx-claude", "exit");
                    T.step("wx-send", "enter");
                    await sendMessage(roomId, claudeReply2, token);
                    T.step("wx-send", "exit");
                    ctx.waitUntil(T.flush());
                    return;
                  }
                  T.step("wx-revision", "exit", { result: "no_history" });
                  T.step("wx-send", "enter");
                  await sendMessage(roomId, `I don't have a previous quote to modify. Could you give me the full request? For example: "quote 10 MR44 hardware only"`, token);
                  T.step("wx-send", "exit");
                  ctx.waitUntil(T.flush());
                  return;
                }
                if (quoteText !== text && (!quoteParsed.unresolvedCategories || quoteParsed.unresolvedCategories.length === 0)) {
                  const fromOriginal = parseMessage(text);
                  if (fromOriginal && fromOriginal.unresolvedCategories && fromOriginal.unresolvedCategories.length > 0) {
                    quoteParsed.unresolvedCategories = fromOriginal.unresolvedCategories;
                  }
                }
                const quoteResult = buildQuoteResponse(quoteParsed);
                if (quoteResult.message && !quoteResult.needsLlm) {
                  await addToHistory(kv, personId, "user", text);
                  await addToHistory(kv, personId, "assistant", quoteResult.message);
                  T.step("wx-send", "enter");
                  await sendMessage(roomId, `${quoteResult.message}

_\u26A1 CF-routed deterministic (${activeClassification.elapsed}ms classify, free)_`, token);
                  T.step("wx-send", "exit");
                  T.step("wx-d1", "enter");
                  logBotUsageToD1(env, { personId, requestText: text, responsePath: "cf-deterministic", model: routingTag, durationMs: Date.now() - _wxStartMs, responseText: quoteResult.message }).catch(() => {
                  });
                  writeMetric(env, { path: "cf-deterministic", durationMs: Date.now() - _wxStartMs, personId });
                  T.step("wx-d1", "exit");
                  ctx.waitUntil(T.flush());
                  return;
                }
                if (quoteResult.errors && quoteResult.errors.length > 0) {
                  const errorContext = quoteResult.errors.join("\n");
                  console.log(`[CF-First] Deterministic errors, escalating to Claude: ${errorContext}`);
                  T.step("wx-claude", "enter");
                  const claudeReply2 = await askClaude(`${text}

(Note: these SKU issues were detected: ${errorContext})`, personId, env, null, null, ctx);
                  T.step("wx-claude", "exit");
                  T.step("wx-send", "enter");
                  await sendMessage(roomId, claudeReply2, token);
                  T.step("wx-send", "exit");
                  ctx.waitUntil(T.flush());
                  return;
                }
              }
              {
                T.step("wx-parse", "exit", { result: "no_parse" });
                try {
                  const storedVision = await kv.get(`vision_skus_${personId}`, "json");
                  const storedSkus = Array.isArray(storedVision) ? storedVision : storedVision && storedVision.skus;
                  if (storedSkus && storedSkus.length > 0) {
                    const storedMeta = Array.isArray(storedVision) ? {} : storedVision || {};
                    console.log(`[CF-First] Found ${storedSkus.length} vision SKUs in KV, building license renewal`);
                    const dashQuote = buildDashboardRenewalQuote(storedSkus, {
                      mxEdition: storedMeta.mxEdition,
                      mrEdition: storedMeta.mrEdition
                    });
                    if (dashQuote && dashQuote.message) {
                      const skuSummary = storedSkus.map((s) => `**${s.sku}** \xD7 ${s.qty}`).join("\n");
                      const combined = `**Detected SKUs:**
${skuSummary}

---

${dashQuote.message}`;
                      await addToHistory(kv, personId, "user", text);
                      await addToHistory(kv, personId, "assistant", combined);
                      T.step("wx-send", "enter");
                      await sendMessage(roomId, `${combined}

_\u26A1 Vision follow-up + License Renewal (${activeClassification.elapsed}ms classify, free)_`, token);
                      T.step("wx-send", "exit");
                      T.step("wx-d1", "enter");
                      logBotUsageToD1(env, { personId, requestText: text, responsePath: "cf-vision-followup-quote", durationMs: Date.now() - _wxStartMs, responseText: combined }).catch(() => {
                      });
                      writeMetric(env, { path: "cf-vision-followup-quote", durationMs: Date.now() - _wxStartMs, personId });
                      T.step("wx-d1", "exit");
                      await kv.delete(`vision_skus_${personId}`);
                      ctx.waitUntil(T.flush());
                      return;
                    }
                    const visionSkuText = storedSkus.map((s) => `${s.qty} ${s.sku}`).join(", ");
                    const visionParsed = parseMessage(visionSkuText);
                    if (visionParsed && visionParsed.items.length > 0) {
                      const visionResult = buildQuoteResponse(visionParsed);
                      if (visionResult.message && !visionResult.needsLlm) {
                        await addToHistory(kv, personId, "user", text);
                        await addToHistory(kv, personId, "assistant", visionResult.message);
                        T.step("wx-send", "enter");
                        await sendMessage(roomId, `${visionResult.message}

_\u26A1 Vision follow-up + Deterministic Quote (${activeClassification.elapsed}ms classify, free)_`, token);
                        T.step("wx-send", "exit");
                        T.step("wx-d1", "enter");
                        logBotUsageToD1(env, { personId, requestText: text, responsePath: "cf-vision-followup-quote", durationMs: Date.now() - _wxStartMs, responseText: visionResult.message }).catch(() => {
                        });
                        writeMetric(env, { path: "cf-vision-followup-quote", durationMs: Date.now() - _wxStartMs, personId });
                        T.step("wx-d1", "exit");
                        await kv.delete(`vision_skus_${personId}`);
                        ctx.waitUntil(T.flush());
                        return;
                      }
                    }
                  }
                } catch (_visionErr) {
                  console.warn(`[CF-First] Vision SKU follow-up check failed: ${_visionErr.message}`);
                }
              }
              {
                const _rawSourceText = text || quoteText || "";
                const _valText = _rawSourceText.toUpperCase();
                const _allTokens = [];
                const _hwRe = /\b(\d+)?\s*[xX×]?\s*((?:MR|MX|MV|MG|MS|MT|CW|C9|C8|Z)\d[\w-]*)(?:\s*[xX×]?\s*(\d+))?\b/gi;
                const _licRe = /\b(\d+)?\s*[xX×]?\s*(LIC-[A-Z0-9-]+)(?:\s*[xX×]?\s*(\d+))?\b/gi;
                let _m;
                while ((_m = _hwRe.exec(_valText)) !== null) {
                  const qty = parseInt(_m[1] || _m[3] || "1");
                  _allTokens.push({ sku: _m[2].toUpperCase(), qty, isLicense: false });
                }
                while ((_m = _licRe.exec(_valText)) !== null) {
                  const qty = parseInt(_m[1] || _m[3] || "1");
                  _allTokens.push({ sku: _m[2].toUpperCase(), qty, isLicense: true });
                }
                const _byKey = /* @__PURE__ */ new Map();
                for (const t of _allTokens) {
                  const prev = _byKey.get(t.sku);
                  if (!prev || t.qty > prev.qty) _byKey.set(t.sku, t);
                }
                const _cleanTokens = [..._byKey.values()].map((t) => ({
                  raw: t.sku,
                  clean: t.isLicense ? t.sku : t.sku.replace(/-(RTG|MR|HW)$/i, ""),
                  isLicense: t.isLicense,
                  qty: t.qty
                }));
                if (_cleanTokens.length > 0) {
                  const _suggestions = [];
                  const _validItems = [];
                  for (const tk of _cleanTokens) {
                    if (tk.isLicense) {
                      _validItems.push({ raw: tk.raw, qty: tk.qty });
                    } else {
                      const val = validateSku(tk.clean);
                      if (val.valid) {
                        _validItems.push({ raw: tk.raw, qty: tk.qty });
                      } else {
                        _suggestions.push({ input: tk.raw, reason: val.reason || `${tk.raw} is not a recognized model`, suggest: val.suggest || [] });
                      }
                    }
                  }
                  if (_suggestions.length > 0 || _validItems.length > 0) {
                    let _msg = "";
                    for (const s of _suggestions) {
                      _msg += `\u26A0\uFE0F **${s.input}**: ${s.reason}
`;
                      if (s.suggest.length > 0) _msg += `Did you mean: ${s.suggest.join(", ")}?
`;
                      _msg += "\n";
                    }
                    if (_validItems.length > 0) {
                      const _validText = _validItems.map((it) => `${it.qty} ${it.raw}`).join(", ");
                      const _reParsed = parseMessage(_validText);
                      if (_reParsed) {
                        const _reResult = buildQuoteResponse(_reParsed);
                        if (_reResult.message && !_reResult.needsLlm) {
                          if (_suggestions.length > 0) {
                            _msg += `_The items above were skipped. Quote generated for recognized models below._

`;
                          }
                          _msg += _reResult.message;
                          await addToHistory(kv, personId, "user", text);
                          await addToHistory(kv, personId, "assistant", _msg);
                          T.step("wx-send", "enter");
                          await sendMessage(roomId, `${_msg}

_\u26A1 Validated + Deterministic (${activeClassification.elapsed}ms classify, free)_`, token);
                          T.step("wx-send", "exit");
                          ctx.waitUntil(T.flush());
                          return;
                        }
                      }
                    }
                    if (_suggestions.length > 0 && _validItems.length === 0) {
                      _msg += `Please correct the SKUs above and try again.`;
                      await addToHistory(kv, personId, "user", text);
                      await addToHistory(kv, personId, "assistant", _msg);
                      T.step("wx-send", "enter");
                      await sendMessage(roomId, _msg, token);
                      T.step("wx-send", "exit");
                      ctx.waitUntil(T.flush());
                      return;
                    }
                  }
                }
              }
              console.log("[CF-First] Deterministic couldn't execute CF quote intent, falling to Claude");
            } else if (activeClassification.intent === "revise" && activeClassification._v2) {
              T.step("wx-revise-v2", "enter");
              console.log(`[CF-First] Revise intent with V2 action=${activeClassification._v2?.modifiers?.action || "?"}`);
              try {
                const history = await getHistory(kv, personId);
                if (!history || history.length === 0) {
                  T.step("wx-revise-v2", "exit", { result: "no_history" });
                  const noHistMsg = `I don't have a previous quote to modify. Could you give me the full request? For example: "quote 10 MR44 hardware only"`;
                  await addToHistory(kv, personId, "user", text);
                  await addToHistory(kv, personId, "assistant", noHistMsg);
                  T.step("wx-send", "enter");
                  await sendMessage(roomId, noHistMsg, token);
                  T.step("wx-send", "exit");
                  ctx.waitUntil(T.flush());
                  return;
                }
                let priorParsed = null;
                for (let i = history.length - 1; i >= 0; i--) {
                  const msg2 = history[i];
                  if (msg2.role !== "assistant" || !msg2.content) continue;
                  const fromUrl = extractPriorFromAssistantUrl(msg2.content);
                  if (fromUrl) {
                    priorParsed = fromUrl;
                    console.log(`[CF-First] Revise: using assistant-URL prior state (items=${priorParsed.items?.length || 0}, term=${priorParsed.requestedTerm}, tier=${priorParsed.requestedTier})`);
                    break;
                  }
                }
                if (!priorParsed) {
                  for (let i = history.length - 1; i >= 0; i--) {
                    const msg2 = history[i];
                    if (msg2.role !== "user" || !msg2.content) continue;
                    const candidate = parseMessage(msg2.content);
                    if (candidate && (candidate.items?.length > 0 || candidate.directLicense || candidate.directLicenseList)) {
                      priorParsed = candidate;
                      console.log(`[CF-First] Revise: using user-message prior (parseMessage)`);
                      break;
                    }
                  }
                }
                if (!priorParsed) {
                  T.step("wx-revise-v2", "exit", { result: "no_prior_quote" });
                  console.log("[CF-First] Revise: no parseable prior quote in history, falling to Claude");
                  T.step("wx-claude", "enter");
                  const claudeReply2 = await askClaude(`${text}

(Note: The user is modifying their previous quote request. Use the conversation history to understand what they originally asked for, apply the requested change, and generate updated URLs.)`, personId, env, null, null, ctx);
                  T.step("wx-claude", "exit");
                  T.step("wx-send", "enter");
                  await sendMessage(roomId, claudeReply2, token);
                  T.step("wx-send", "exit");
                  ctx.waitUntil(T.flush());
                  return;
                }
                const revised = applyV2Revision(priorParsed, activeClassification._v2);
                if (!revised) {
                  T.step("wx-revise-v2", "exit", { result: "unhandled_action" });
                  console.log("[CF-First] Revise: applyV2Revision returned null (unhandled action), falling to Claude");
                  T.step("wx-claude", "enter");
                  const claudeReply2 = await askClaude(`${text}

(Note: The user is modifying their previous quote request. Use the conversation history to understand what they originally asked for, apply the requested change, and generate updated URLs.)`, personId, env, null, null, ctx);
                  T.step("wx-claude", "exit");
                  T.step("wx-send", "enter");
                  await sendMessage(roomId, claudeReply2, token);
                  T.step("wx-send", "exit");
                  ctx.waitUntil(T.flush());
                  return;
                }
                console.log(`[CF-First] V2 revision applied: ${revised._revised || "unknown"}, items=${revised.items?.length || 0}`);
                const revisedResult = buildQuoteResponse(revised);
                if (revisedResult.message && !revisedResult.needsLlm) {
                  T.step("wx-revise-v2", "exit", { result: "success", action: revised._revised });
                  await addToHistory(kv, personId, "user", text);
                  await addToHistory(kv, personId, "assistant", revisedResult.message);
                  T.step("wx-send", "enter");
                  await sendMessage(roomId, `${revisedResult.message}

_\u26A1 CF-routed V2 revision (${activeClassification.elapsed}ms classify, free)_`, token);
                  T.step("wx-send", "exit");
                  T.step("wx-d1", "enter");
                  logBotUsageToD1(env, { personId, requestText: text, responsePath: "cf-v2-revise", durationMs: Date.now() - _wxStartMs, responseText: revisedResult.message }).catch(() => {
                  });
                  writeMetric(env, { path: "cf-v2-revise", durationMs: Date.now() - _wxStartMs, personId });
                  T.step("wx-d1", "exit");
                  ctx.waitUntil(T.flush());
                  return;
                }
                T.step("wx-revise-v2", "exit", { result: "build_failed" });
                console.log("[CF-First] Revise: buildQuoteResponse failed on revised state, falling to Claude");
                T.step("wx-claude", "enter");
                const fallbackReply = await askClaude(`${text}

(Note: The user is modifying their previous quote request. Use the conversation history to understand what they originally asked for, apply the requested change, and generate updated URLs.)`, personId, env, null, null, ctx);
                T.step("wx-claude", "exit");
                T.step("wx-send", "enter");
                await sendMessage(roomId, fallbackReply, token);
                T.step("wx-send", "exit");
                ctx.waitUntil(T.flush());
                return;
              } catch (reviseErr) {
                T.step("wx-revise-v2", "exit", { result: "error", message: reviseErr?.message });
                console.warn(`[CF-First] V2 revision error, falling to Claude: ${reviseErr?.message}`);
              }
            }
          }
          T.step("wx-claude", "enter");
          const _claudeBudgetMs = 24e3 - (Date.now() - _wxStartMs);
          let claudeReply = null;
          if (_claudeBudgetMs > 3e3) {
            claudeReply = await Promise.race([
              askClaude(text, personId, env, null, activeClassification, ctx),
              new Promise((resolve) => setTimeout(() => resolve(null), _claudeBudgetMs))
            ]);
          } else {
            console.warn(`[Claude-Budget] Only ${_claudeBudgetMs}ms left after classifier burn \u2014 skipping Claude call`);
          }
          const _claudeTimedOut = claudeReply == null;
          if (_claudeTimedOut) {
            claudeReply = `\u26A0\uFE0F I'm running slow right now and couldn't finish that request in time. Please try again in a moment \u2014 or for quotes, send a plain SKU list like "2 x LIC-ENT-3YR".`;
          }
          T.step("wx-claude", "exit", { timedOut: _claudeTimedOut });
          T.step("wx-send", "enter");
          await sendMessage(roomId, claudeReply, token);
          T.step("wx-send", "exit");
          T.step("wx-d1", "enter");
          logBotUsageToD1(env, { personId, requestText: text, responsePath: _claudeTimedOut ? "claude-timeout" : "claude", durationMs: Date.now() - _wxStartMs, responseText: claudeReply, errorMessage: _claudeTimedOut ? "CLAUDE_BUDGET_TIMEOUT" : void 0 }).catch(() => {
          });
          writeMetric(env, { path: _claudeTimedOut ? "claude-timeout" : "claude", durationMs: Date.now() - _wxStartMs, personId });
          T.step("wx-d1", "exit");
          T.step("wx-history", "enter");
          T.step("wx-history", "exit");
          ctx.waitUntil(T.flush());
        } catch (err) {
          console.error("Webhook error:", err.message, err.stack);
          try {
            const event = body;
            if (event?.data?.roomId) {
              await sendMessage(event.data.roomId, `\u26A0\uFE0F Something went wrong processing your request. Try again with a specific SKU like "quote 10 MR44".`, env.WEBEX_BOT_TOKEN);
            }
          } catch (notifyErr) {
            console.error("Failed to send error notification:", notifyErr.message);
          }
          ctx.waitUntil(T.flush());
        }
      })());
      return new Response("OK", { status: 200 });
    }
    if (url.pathname === "/test-routing") {
      const input = url.searchParams.get("input");
      if (!input) return new Response(JSON.stringify({ error: "input required" }), { headers: { "content-type": "application/json" } });
      const result = { input, layer: null, response: null, details: {} };
      const startMs = Date.now();
      try {
        const eolReply = handleEolDateRequest(input);
        if (eolReply) {
          result.layer = "deterministic-eol";
          result.response = eolReply.substring(0, 300);
          result.details.ms = Date.now() - startMs;
          return new Response(JSON.stringify(result, null, 2), { headers: { "content-type": "application/json" } });
        }
        const pricingIntent = /\b(COSTS?|PRICES?|PRICING|HOW MUCH|TOTAL|WHAT DOES .* COSTS?|WHAT IS THE COSTS?|WHAT('S| IS) THE PRICES?)\b/i.test(input);
        if (pricingIntent) {
          const directSkuMatch = input.match(/(?:cost|price|pricing|how much)(?:\s+(?:of|for))?\s+(\d+)\s*x?\s+([A-Z0-9][-A-Z0-9]+)/i);
          const singleSkuMatch = !directSkuMatch && input.match(/(?:cost|price|pricing|how much)(?:\s+(?:of|for|is|does))?\s+(?:an?\s+)?([A-Z0-9][-A-Z0-9]+)/i);
          if (directSkuMatch) {
            const qty = parseInt(directSkuMatch[1]);
            const sku = directSkuMatch[2].toUpperCase();
            const resp = formatPricingResponse(null, [sku], [qty]);
            if (resp) {
              result.layer = "deterministic-pricing";
              result.response = resp.substring(0, 300);
              result.details = { sku, qty, ms: Date.now() - startMs };
              return new Response(JSON.stringify(result, null, 2), { headers: { "content-type": "application/json" } });
            }
          }
          const reverseSkuMatch = !directSkuMatch && !singleSkuMatch && input.match(/(?:what|how)\s+(?:does|do|is|would)\s+(?:an?\s+)?(?:the\s+)?(\d+\s+)?([A-Z0-9][-A-Z0-9]+)\s+(?:cost|run|go for|price)/i);
          const pricingSkuMatch = singleSkuMatch || reverseSkuMatch;
          if (pricingSkuMatch && !/^(OPTION|THE|THIS|THAT|MY|IT|A|AN)$/i.test(pricingSkuMatch[reverseSkuMatch ? 2 : 1])) {
            const skuIdx = reverseSkuMatch ? 2 : 1;
            const qtyIdx = reverseSkuMatch ? 1 : null;
            const sku = pricingSkuMatch[skuIdx].toUpperCase();
            const qty = qtyIdx && pricingSkuMatch[qtyIdx] ? parseInt(pricingSkuMatch[qtyIdx]) : 1;
            const resp = formatPricingResponse(null, [sku], [qty]);
            if (resp) {
              result.layer = "deterministic-pricing";
              result.response = resp.substring(0, 300);
              result.details = { sku, qty, ms: Date.now() - startMs };
              return new Response(JSON.stringify(result, null, 2), { headers: { "content-type": "application/json" } });
            }
            result.details.pricingSkuAttempt = sku;
          }
        }
        const parsed = parseMessage(input);
        if (parsed && parsed.isClarification && parsed.clarificationMessage) {
          result.layer = "deterministic-clarify";
          result.response = parsed.clarificationMessage.substring(0, 300);
          result.details.ms = Date.now() - startMs;
          return new Response(JSON.stringify(result, null, 2), { headers: { "content-type": "application/json" } });
        }
        const classification = await classifyWithCF(input, env);
        if (classification) {
          result.details.cfIntent = classification.intent;
          result.details.cfElapsed = classification.elapsed;
          result.details.cfReply = (classification.reply || "").substring(0, 300);
          result.details.cfExtracted = classification.extracted || "";
          if (classification.intent === "clarify" && classification.reply) {
            result.layer = "cf-clarify";
            result.response = classification.reply.substring(0, 300);
            result.details.ms = Date.now() - startMs;
            return new Response(JSON.stringify(result, null, 2), { headers: { "content-type": "application/json" } });
          }
          if (classification.intent === "product_info") {
            result.layer = "claude";
            result.response = "[Product info question routed to Claude by CF]";
            result.details.ms = Date.now() - startMs;
            result.details.productInfoRoute = "cf-to-claude";
            return new Response(JSON.stringify(result, null, 2), { headers: { "content-type": "application/json" } });
          }
          if (classification.intent === "escalate") {
            result.layer = "claude";
            result.response = "[Escalated to Claude by CF classifier]";
            result.details.ms = Date.now() - startMs;
            result.details.escalateReason = "cf-escalate";
            return new Response(JSON.stringify(result, null, 2), { headers: { "content-type": "application/json" } });
          }
          if (classification.intent === "conversation") {
            const convoReply = classification.reply && classification.reply.length > 5 ? classification.reply : (await askCFConversation(input, env))?.response;
            if (convoReply) {
              result.layer = "cf-conversation";
              result.response = convoReply.substring(0, 300);
              result.details.ms = Date.now() - startMs;
              return new Response(JSON.stringify(result, null, 2), { headers: { "content-type": "application/json" } });
            }
          }
          if (classification.intent === "quote") {
            const quoteText = classification.extracted || input;
            const quoteParsed = preserveMsAdvancedTier(parseMessage(quoteText), input);
            if (quoteParsed && !quoteParsed.isClarification) {
              if (quoteText !== input && (!quoteParsed.unresolvedCategories || quoteParsed.unresolvedCategories.length === 0)) {
                const fromOriginal = parseMessage(input);
                if (fromOriginal && fromOriginal.unresolvedCategories && fromOriginal.unresolvedCategories.length > 0) {
                  quoteParsed.unresolvedCategories = fromOriginal.unresolvedCategories;
                }
              }
              const quoteResult = buildQuoteResponse(quoteParsed);
              if (quoteResult.message && !quoteResult.needsLlm) {
                result.layer = "cf-deterministic";
                result.response = quoteResult.message.substring(0, 500);
                result.details.ms = Date.now() - startMs;
                return new Response(JSON.stringify(result, null, 2), { headers: { "content-type": "application/json" } });
              }
              if (quoteResult.errors) {
                result.details.deterministicErrors = quoteResult.errors;
              }
            }
            result.details.cfExtractedButFailed = true;
          }
        } else {
          result.details.cfFailed = true;
        }
        result.layer = "claude";
        result.response = "[Would fall through to Claude API]";
        result.details.ms = Date.now() - startMs;
        return new Response(JSON.stringify(result, null, 2), { headers: { "content-type": "application/json" } });
      } catch (err) {
        result.layer = "error";
        result.response = err.message;
        result.details.ms = Date.now() - startMs;
        return new Response(JSON.stringify(result, null, 2), { headers: { "content-type": "application/json" } });
      }
    }
    if (url.pathname === "/api/benchmark-classifier") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Bench-Key, X-Eval-Run-Id" } });
      if (request.method !== "POST") return new Response("POST required", { status: 405 });
      const key = request.headers.get("X-Bench-Key");
      if (!env.DASHBOARD_KEY || key !== env.DASHBOARD_KEY) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
      try {
        const body = await request.json();
        const input = body.input;
        const priorCtx = body.prior_context || "";
        const model = body.model || "@cf/meta/llama-4-scout-17b-16e-instruct";
        const requestedReasoningPolicy = normalizeReasoningPolicy(body.reasoning_policy || body.reasoningPolicy || REASONING_POLICY_DISABLED);
        const reasoningControl = getReasoningControl(model, requestedReasoningPolicy);
        const evalRunId = request.headers.get("X-Eval-Run-Id") || null;
        const evalContext = evalRunId ? {
          runId: evalRunId,
          endpoint: url.pathname,
          requestText: input,
          requestedModel: model,
          personId: "benchmark-classifier",
          bot: "webex",
          reasoningPolicy: reasoningControl.reasoningPolicy,
          reasoningDisableSupported: reasoningControl.reasoningDisableSupported,
          reasoningControlJson: JSON.stringify({ control: reasoningControl.reasoningControl, requestedPolicy: requestedReasoningPolicy })
        } : null;
        const promptVariant = (body.prompt_variant || "v2").toLowerCase();
        if (!input) return new Response(JSON.stringify({ error: "input required" }), { status: 400, headers: { "content-type": "application/json" } });
        const deepSeekRequested = isDeepSeekModel(model);
        if (!deepSeekRequested && !env.AI) return new Response(JSON.stringify({ error: "env.AI not bound" }), { status: 500, headers: { "content-type": "application/json" } });
        if (deepSeekRequested && !env.DEEPSEEK_API_KEY) return new Response(JSON.stringify({ error: "DEEPSEEK_API_KEY not bound" }), { status: 500, headers: { "content-type": "application/json" } });
        const systemPrompt = promptVariant === "legacy" ? CF_CLASSIFIER_PROMPT : CF_CLASSIFIER_PROMPT_V2;
        const userText = priorCtx ? `Prior assistant context:
${priorCtx}

User message:
${input}` : input;
        const start = Date.now();
        let aiResult, err = null, attempts = 1, transientErrors = [], tokenUsage = {}, costUsd = 0;
        let executedModel = model;
        let raw = null, parsed = null, parseError = null;
        let effectiveReasoningControl = reasoningControl;
        if (deepSeekRequested) {
          aiResult = await callDeepSeekChatCompletion(env, {
            model,
            systemPrompt,
            userText,
            thinkingType: requestedReasoningPolicy === REASONING_POLICY_ENABLED_ABLATION ? "enabled" : "disabled",
            jsonMode: true,
            maxTokens: 4096,
            reasoningPolicy: requestedReasoningPolicy
          });
          attempts = aiResult?.attempts || 1;
          transientErrors = aiResult?.transientErrors || [];
          tokenUsage = aiResult?.usage || {};
          costUsd = aiResult?.costUsd || 0;
          err = aiResult?.error || null;
          raw = aiResult?.raw ?? null;
          if (err && aiResult?.shouldFallbackToClaude) {
            const fallback = await callClaudeClassifierJsonFallback(env, { systemPrompt, userText });
            transientErrors = [...transientErrors, err];
            attempts += fallback?.attempts || 0;
            tokenUsage = fallback?.usage || {};
            costUsd += fallback?.costUsd || 0;
            executedModel = fallback?.model || "claude-sonnet-4-6";
            aiResult = fallback;
            err = fallback?.error || null;
            raw = fallback?.raw ?? null;
          }
          const extracted = extractJsonFromText(raw);
          raw = extracted.raw;
          parsed = extracted.parsed;
          parseError = extracted.parseError;
        } else {
          const isGemma = /gemma/i.test(model);
          const isReasoningHeavyCfClassifier = /gpt-oss|nemotron|qwen|kimi/i.test(model);
          const classifierMaxTokens = isReasoningHeavyCfClassifier ? 2048 : 1024;
          const requestBody = isGemma ? { messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userText }], max_completion_tokens: 4096 } : { messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userText }], max_tokens: classifierMaxTokens };
          applyReasoningRequestOptions(requestBody, reasoningControl);
          try {
            aiResult = await env.AI.run(model, requestBody);
          } catch (e) {
            const optionKeys = Object.keys(reasoningControl?.requestOptions || {});
            if (optionKeys.length > 0 && isReasoningControlRejection(e)) {
              for (const key2 of optionKeys) delete requestBody[key2];
              effectiveReasoningControl = {
                ...reasoningControl,
                reasoningPolicy: REASONING_POLICY_UNSUPPORTED,
                reasoningDisableSupported: false,
                reasoningControl: `${reasoningControl.reasoningControl}_rejected`
              };
              try {
                aiResult = await env.AI.run(model, requestBody);
              } catch (e2) {
                err = e2.message;
              }
            } else {
              err = e.message;
            }
          }
        }
        const elapsed = Date.now() - start;
        if (!deepSeekRequested && aiResult) {
          raw = aiResult.response ?? aiResult.choices?.[0]?.message?.content ?? null;
          if ((raw === null || raw === void 0) && aiResult.choices?.[0]?.message?.reasoning) {
            const reasoning = aiResult.choices[0].message.reasoning;
            const jsonInReasoning = reasoning.match(/\{[\s\S]*\}/);
            if (jsonInReasoning) raw = jsonInReasoning[0];
          }
          if (raw === null || raw === void 0) raw = aiResult.result?.response ?? null;
          if (typeof raw === "object" && raw !== null) {
            parsed = raw;
            raw = JSON.stringify(raw);
          } else if (typeof raw === "string" && !raw.startsWith("__DEBUG_")) {
            try {
              const m = raw.match(/\{[\s\S]*\}/);
              if (m) parsed = JSON.parse(m[0]);
            } catch (e) {
              parseError = e.message;
            }
          }
          tokenUsage = aiResult?.usage || aiResult?.result?.usage || {};
        }
        const resultReasoningPolicy = aiResult?.reasoningPolicy ?? aiResult?.reasoning_policy ?? effectiveReasoningControl?.reasoningPolicy ?? reasoningControl?.reasoningPolicy;
        const resultReasoningDisableSupported = aiResult?.reasoningDisableSupported ?? aiResult?.reasoning_disable_supported ?? effectiveReasoningControl?.reasoningDisableSupported ?? reasoningControl?.reasoningDisableSupported;
        const resultReasoningControl = aiResult?.reasoningControl ?? aiResult?.reasoning_control ?? effectiveReasoningControl?.reasoningControl ?? reasoningControl?.reasoningControl;
        if (evalContext) {
          await logBotUsageToD1(env, {
            personId: "benchmark-classifier",
            requestText: input,
            responsePath: err ? "error" : "crm_agent",
            model: executedModel,
            requestedModel: model,
            executedModel,
            tierPath: executedModel === model ? model : `${model},${executedModel}`,
            liveLlmCall: true,
            tier0Deterministic: false,
            attempts,
            transientErrors: err ? [...transientErrors, err] : transientErrors,
            inputTokens: tokenUsage.input_tokens || tokenUsage.prompt_tokens || 0,
            outputTokens: tokenUsage.output_tokens || tokenUsage.completion_tokens || 0,
            costUsd,
            durationMs: elapsed,
            errorMessage: err || parseError || null,
            responseText: raw || JSON.stringify(parsed || ""),
            endpoint: url.pathname,
            evalContext,
            reasoningPolicy: resultReasoningPolicy,
            reasoningDisableSupported: resultReasoningDisableSupported,
            reasoningControlJson: JSON.stringify({ control: resultReasoningControl, requestedPolicy: requestedReasoningPolicy })
          });
        }
        return new Response(JSON.stringify({
          model,
          executed_model: executedModel,
          prompt_variant: promptVariant,
          input,
          elapsed,
          raw,
          parsed,
          parseError,
          err,
          attempts,
          transientErrors,
          usage: tokenUsage,
          costUsd,
          reasoning_policy: resultReasoningPolicy,
          reasoningPolicy: resultReasoningPolicy,
          reasoning_disable_supported: resultReasoningDisableSupported,
          reasoningDisableSupported: resultReasoningDisableSupported,
          reasoning_control: resultReasoningControl,
          reasoningControl: resultReasoningControl
        }), { headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { "content-type": "application/json" } });
      }
    }
    if (url.pathname === "/api/benchmark-product-info") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Bench-Key, X-Eval-Run-Id" } });
      if (request.method !== "POST") return new Response("POST required", { status: 405 });
      const key = request.headers.get("X-Bench-Key");
      if (!env.DASHBOARD_KEY || key !== env.DASHBOARD_KEY) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
      try {
        const body = await request.json();
        const input = body.input;
        const modelKey = (body.model || "claude").toLowerCase();
        const requestedReasoningPolicy = normalizeReasoningPolicy(body.reasoning_policy || body.reasoningPolicy || REASONING_POLICY_DISABLED);
        const reasoningControl = getReasoningControl(modelKey, requestedReasoningPolicy);
        const evalRunId = request.headers.get("X-Eval-Run-Id") || null;
        const evalContext = evalRunId ? {
          runId: evalRunId,
          endpoint: url.pathname,
          requestText: input,
          requestedModel: modelKey,
          personId: "benchmark-product-info",
          bot: "webex",
          reasoningPolicy: reasoningControl.reasoningPolicy,
          reasoningDisableSupported: reasoningControl.reasoningDisableSupported,
          reasoningControlJson: JSON.stringify({ control: reasoningControl.reasoningControl, requestedPolicy: requestedReasoningPolicy })
        } : null;
        const priorCtx = body.prior_context || "";
        const wantLiveDatasheet = !!body.want_live_datasheet;
        const promptVariant = (body.prompt_variant || "baseline").toLowerCase();
        if (!input) return new Response(JSON.stringify({ error: "input required" }), { status: 400, headers: { "content-type": "application/json" } });
        let systemPrompt = SYSTEM_PROMPT;
        const sources = { liveModels: [], liveUrls: [], fetchFailed: false, cachedModels: [], categoryFamilies: [] };
        if (wantLiveDatasheet) {
          let datasheetContext = await getRelevantDatasheetContext(input);
          if (!datasheetContext && priorCtx) datasheetContext = await getRelevantDatasheetContext(priorCtx);
          if (datasheetContext) {
            systemPrompt += "\n\n" + datasheetContext.text;
            systemPrompt += "\n\nThe user requested live datasheet verification. Use the live datasheet content above as the authoritative source.";
            sources.liveModels.push(...datasheetContext.models || []);
            sources.liveUrls.push(...datasheetContext.urls || []);
          } else {
            sources.fetchFailed = true;
            const staticContext = getStaticSpecsContext(priorCtx || input);
            if (staticContext) {
              systemPrompt += "\n\n" + staticContext.text;
              sources.cachedModels.push(...staticContext.models || []);
            }
          }
        } else {
          const staticContext = getStaticSpecsContext(input);
          let categoryContext = null;
          let categoryFamilies = [];
          if (!staticContext) {
            const catUpper = input.toUpperCase();
            const families = [];
            if (/\b(FIREWALL|SECURITY\s*APPLIANCE|MX|GATEWAY)\b/.test(catUpper)) families.push("MX");
            if (/\b(ACCESS\s*POINT|WIFI|WI-?FI|WIRELESS|AP)\b/.test(catUpper)) families.push("MR", "CW");
            if (/\b(SWITCH|SWITCHING)\b/.test(catUpper)) families.push("MS130", "MS150");
            if (/\b(CAMERA|SURVEILLANCE|VIDEO)\b/.test(catUpper)) families.push("MV");
            if (/\b(SENSOR)\b/.test(catUpper)) families.push("MT");
            if (/\b(CELLULAR|LTE|5G|WAN\s*GATEWAY)\b/.test(catUpper)) families.push("MG");
            if (families.length > 0) {
              let ctx2 = "## PRODUCT SPECS (from specs.json \u2014 AUTHORITATIVE)\n";
              ctx2 += "Use ONLY these specs. Do NOT supplement with training data. If a spec is not listed here, say you do not have that data and offer to check the datasheet.\n";
              ctx2 += 'FORMATTING: Webex does NOT render pipe-delimited markdown tables ("| col | col |") \u2014 they show as literal pipes. For multi-model comparisons use grouped bullets under a bolded model header, not tables.\n\n';
              for (const fam of families) {
                const familyData = specs[fam];
                if (familyData) {
                  for (const [model, modelSpecs] of Object.entries(familyData)) {
                    ctx2 += `${model}: ${JSON.stringify(modelSpecs)}
`;
                  }
                }
              }
              categoryContext = ctx2;
              categoryFamilies = families;
            }
          }
          if (staticContext) {
            systemPrompt += "\n\n" + staticContext.text;
            sources.cachedModels.push(...staticContext.models || []);
          } else if (categoryContext) {
            systemPrompt += "\n\n" + categoryContext;
            sources.categoryFamilies.push(...categoryFamilies);
          }
        }
        const pricingIntent = /\b(COSTS?|PRICES?|PRICING|HOW MUCH|TOTAL|CART TOTAL|BREAKDOWN|ESTIMATE|INCLUDE\s+(COST|COSTS|PRICE|PRICES|PRICING)|WITH\s+(COST|COSTS|PRICE|PRICES|PRICING))\b/i.test(input);
        if (pricingIntent) {
          const priceContext = getRelevantPriceContext(input, []);
          if (priceContext) systemPrompt += "\n\n" + priceContext;
        }
        const accessoriesContext = getAccessoriesContext(input);
        if (accessoriesContext) systemPrompt += "\n\n" + accessoriesContext;
        if (promptVariant === "revised") systemPrompt += CF_GROUNDING_RULES;
        const messages = [];
        if (priorCtx) messages.push({ role: "assistant", content: priorCtx });
        messages.push({ role: "user", content: input });
        const start = Date.now();
        let reply = null, err = null, rawResult = null;
        if (modelKey === "claude") {
          if (!env.ANTHROPIC_API_KEY) return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not bound" }), { status: 500, headers: { "content-type": "application/json" } });
          try {
            const resp = await fetch(ANTHROPIC_API_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
              body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1024, system: systemPrompt, messages })
            });
            if (!resp.ok) {
              err = `Anthropic ${resp.status}: ${await resp.text()}`;
            } else {
              const data = await resp.json();
              rawResult = data;
              reply = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
            }
          } catch (e) {
            err = e.message;
          }
        } else if (modelKey === "llama") {
          if (!env.AI) return new Response(JSON.stringify({ error: "env.AI not bound" }), { status: 500, headers: { "content-type": "application/json" } });
          try {
            const result = await env.AI.run("@cf/meta/llama-4-scout-17b-16e-instruct", {
              messages: [{ role: "system", content: systemPrompt }, ...messages],
              max_tokens: 1024
            });
            rawResult = result;
            reply = result?.response ?? result?.choices?.[0]?.message?.content ?? null;
          } catch (e) {
            err = e.message;
          }
        } else if (modelKey === "gemma") {
          if (!env.AI) return new Response(JSON.stringify({ error: "env.AI not bound" }), { status: 500, headers: { "content-type": "application/json" } });
          try {
            const result = await env.AI.run("@cf/google/gemma-4-26b-a4b-it", {
              messages: [{ role: "system", content: systemPrompt }, ...messages],
              max_completion_tokens: 2048,
              thinking: { type: "disabled" }
            });
            rawResult = result;
            reply = result?.choices?.[0]?.message?.content ?? result?.response ?? null;
          } catch (e) {
            err = e.message;
          }
        } else {
          return new Response(JSON.stringify({ error: `unknown model "${modelKey}" \u2014 use claude|llama|gemma` }), { status: 400, headers: { "content-type": "application/json" } });
        }
        const elapsed = Date.now() - start;
        const tokenUsage = rawResult?.usage || rawResult?.result?.usage || {};
        if (evalContext) {
          await logBotUsageToD1(env, {
            personId: "benchmark-product-info",
            requestText: input,
            responsePath: err ? "error" : "crm_agent",
            model: modelKey,
            requestedModel: modelKey,
            executedModel: modelKey,
            tierPath: modelKey,
            liveLlmCall: true,
            tier0Deterministic: false,
            attempts: 1,
            transientErrors: err ? [err] : [],
            inputTokens: tokenUsage.input_tokens || tokenUsage.prompt_tokens || 0,
            outputTokens: tokenUsage.output_tokens || tokenUsage.completion_tokens || 0,
            durationMs: elapsed,
            errorMessage: err || null,
            responseText: reply || "",
            endpoint: url.pathname,
            evalContext
          });
        }
        return new Response(JSON.stringify({
          model: modelKey,
          prompt_variant: promptVariant,
          input,
          elapsed,
          reply,
          sources,
          system_prompt_chars: systemPrompt.length,
          err
        }, null, 2), { headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message, stack: e.stack }), { status: 500, headers: { "content-type": "application/json" } });
      }
    }
    return new Response("Not Found", { status: 404 });
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map