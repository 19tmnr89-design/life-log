/* ふるさと納税 上限額シミュレーション — 税制の公開データ
 *
 * ここにあるのはすべて国税庁・総務省が公表している速算表・控除額の一覧で、
 * 個人の実データではない（money.app.js の「一般的な費目」と同じ扱い）。
 * 対象は給与所得者（本人）のみ。事業所得・不動産所得などがある場合は対象外。
 *
 * 出典の考え方:
 *   給与所得控除・所得金額調整控除・基礎控除・配偶者控除等 … 所得税法（2020年分以降）
 *   配偶者特別控除の細かい金額表 … 国税庁「配偶者特別控除」の速算表
 *   住民税の基礎控除・配偶者控除等 … 地方税法（所得税と控除額がわずかに異なる）
 *   ふるさと納税の上限額の式 … 総務省ふるさと納税ポータルサイトの計算式
 */

/* ---- 給与所得控除（2020年分以降） ---- */
function employmentIncomeDeduction(income) {
  if (income <= 1625000) return 550000;
  if (income <= 1800000) return Math.round(income * 0.4 - 100000);
  if (income <= 3600000) return Math.round(income * 0.3 + 80000);
  if (income <= 6600000) return Math.round(income * 0.2 + 440000);
  if (income <= 8500000) return Math.round(income * 0.1 + 1100000);
  return 1950000;
}

/* ---- 所得金額調整控除 ----
 * 給与収入850万円超で、23歳未満の扶養親族（16歳未満の子を含む）などがいる場合に適用。
 * 特別障害者に該当する場合の適用は対象外（今回は非対応）。
 */
function incomeAdjustmentDeduction(income, hasQualifyingDependent) {
  if (income <= 8500000 || !hasQualifyingDependent) return 0;
  return Math.round((Math.min(income, 10000000) - 8500000) * 0.1);
}

/* ---- 基礎控除（合計所得金額2,400万円超で逓減） ---- */
function basicDeduction(totalIncome, kind) {
  const table = kind === "resident"
    ? [[24000000, 430000], [24500000, 290000], [25000000, 150000], [Infinity, 0]]
    : [[24000000, 480000], [24500000, 320000], [25000000, 160000], [Infinity, 0]];
  for (const [max, amount] of table) if (totalIncome <= max) return amount;
  return 0;
}

/* ---- 配偶者控除（配偶者の合計所得金額48万円以下＝年収103万円以下） ----
 * 本人の合計所得金額の3区分（900万/950万/1000万円）ごとに額が変わる。
 * 老人控除対象配偶者（70歳以上）の上乗せは今回非対応（一般の配偶者として計算）。
 */
function spouseDeduction(taxpayerIncome, kind) {
  if (taxpayerIncome > 10000000) return 0;
  const table = kind === "resident" ? [330000, 220000, 110000] : [380000, 260000, 130000];
  if (taxpayerIncome <= 9000000) return table[0];
  if (taxpayerIncome <= 9500000) return table[1];
  return table[2];
}

/* ---- 配偶者特別控除（配偶者の合計所得金額48万円超133万円以下） ----
 * 行: 配偶者の合計所得金額の上限（円）。列: 本人の合計所得金額3区分。
 * [所得税, 住民税] のペアで持つ。
 */
const SPOUSE_SPECIAL_TABLE = [
  // 配偶者所得上限,      [tier1所得税,tier1住民税, tier2所得税,tier2住民税, tier3所得税,tier3住民税]
  { max: 950000,  income: [380000, 330000], income2: [260000, 220000], income3: [130000, 110000] },
  { max: 1000000, income: [360000, 330000], income2: [240000, 220000], income3: [120000, 110000] },
  { max: 1050000, income: [310000, 310000], income2: [210000, 210000], income3: [110000, 110000] },
  { max: 1100000, income: [260000, 260000], income2: [180000, 180000], income3: [90000,  90000]  },
  { max: 1150000, income: [210000, 210000], income2: [140000, 140000], income3: [70000,  70000]  },
  { max: 1200000, income: [160000, 160000], income2: [110000, 110000], income3: [60000,  60000]  },
  { max: 1250000, income: [110000, 110000], income2: [80000,  80000],  income3: [40000,  40000]  },
  { max: 1300000, income: [60000,  60000],  income2: [40000,  40000],  income3: [20000,  20000]  },
  { max: 1330000, income: [30000,  30000],  income2: [20000,  20000],  income3: [10000,  10000]  },
];

function spouseSpecialDeduction(taxpayerIncome, spouseIncome, kind) {
  if (taxpayerIncome > 10000000) return 0;
  if (spouseIncome <= 480000 || spouseIncome > 1330000) return 0; // 48万以下は配偶者控除、133万超は対象外
  const row = SPOUSE_SPECIAL_TABLE.find(r => spouseIncome <= r.max);
  if (!row) return 0;
  const idx = kind === "resident" ? 1 : 0;
  const tier = taxpayerIncome <= 9000000 ? row.income : taxpayerIncome <= 9500000 ? row.income2 : row.income3;
  return tier[idx];
}

/* 配偶者（控除 or 特別控除）の合算。年収→所得は給与所得控除で変換（配偶者も給与所得者と仮定）。 */
function totalSpouseDeduction(taxpayerIncome, spouseAnnualIncome, kind) {
  if (!spouseAnnualIncome && spouseAnnualIncome !== 0) return 0;
  const spouseIncome = spouseAnnualIncome > 0
    ? Math.max(0, spouseAnnualIncome - employmentIncomeDeduction(spouseAnnualIncome))
    : 0;
  if (spouseIncome <= 480000) return spouseDeduction(taxpayerIncome, kind);
  return spouseSpecialDeduction(taxpayerIncome, spouseIncome, kind);
}

/* ---- 扶養控除 ---- */
const DEPENDENT_AMOUNTS = {
  // [所得税, 住民税]
  general:      [380000, 330000], // 16〜18歳・23〜69歳
  specific:      [630000, 450000], // 19〜22歳（特定扶養親族）
  elderlyWith:  [580000, 450000], // 70歳以上・同居老親等
  elderlyOther: [480000, 380000], // 70歳以上・その他
};

function dependentDeduction(counts, kind) {
  const idx = kind === "resident" ? 1 : 0;
  return (counts.general || 0) * DEPENDENT_AMOUNTS.general[idx]
    + (counts.specific || 0) * DEPENDENT_AMOUNTS.specific[idx]
    + (counts.elderlyWith || 0) * DEPENDENT_AMOUNTS.elderlyWith[idx]
    + (counts.elderlyOther || 0) * DEPENDENT_AMOUNTS.elderlyOther[idx];
}

/* ---- 所得税の速算表（2023年分以降。復興特別所得税は含まない） ---- */
const INCOME_TAX_BRACKETS = [
  { max: 1949000,   rate: 0.05, deduct: 0 },
  { max: 3299000,   rate: 0.10, deduct: 97500 },
  { max: 6949000,   rate: 0.20, deduct: 427500 },
  { max: 8999000,   rate: 0.23, deduct: 636000 },
  { max: 17999000,  rate: 0.33, deduct: 1536000 },
  { max: 39999000,  rate: 0.40, deduct: 2796000 },
  { max: Infinity,  rate: 0.45, deduct: 4796000 },
];

function incomeTaxBracket(taxableIncome) {
  return INCOME_TAX_BRACKETS.find(b => taxableIncome <= b.max) || INCOME_TAX_BRACKETS[INCOME_TAX_BRACKETS.length - 1];
}

/* 復興特別所得税を加味した所得税率（ふるさと納税の限度額の式で使う） */
const RECONSTRUCTION_SURTAX_RATE = 1.021;

/* 住民税の税率（標準：都道府県4%＋市区町村6%） */
const RESIDENT_TAX_RATE = 0.10;

/* ふるさと納税の申込サイト（プリセット） */
const FURUSATO_SITES = [
  { key: "satofull",  label: "さとふる" },
  { key: "furusato_choice", label: "ふるさとチョイス" },
  { key: "rakuten",   label: "楽天ふるさと納税" },
  { key: "yahoo",     label: "Yahoo!ショッピング" },
  { key: "furunavi",  label: "ふるなび" },
  { key: "au",        label: "au PAY ふるさと納税" },
  { key: "other",     label: "その他" },
];

const FURUSATO_DATA = {
  employmentIncomeDeduction, incomeAdjustmentDeduction, basicDeduction,
  spouseDeduction, spouseSpecialDeduction, totalSpouseDeduction,
  dependentDeduction, incomeTaxBracket, INCOME_TAX_BRACKETS,
  RECONSTRUCTION_SURTAX_RATE, RESIDENT_TAX_RATE, FURUSATO_SITES,
};
