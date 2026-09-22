/* マスターデータ（保険種類・保障種類・教育費の目安など）
 *
 * 金額はすべて「円」。教育費は概算であり、画面から補正できる（app.js 側で上書き値を持つ）。
 */

/* ---- 保険のカテゴリ ---- */
const CATEGORIES = [
  { key: "life",    label: "生命保険（死亡・収入保障）" },
  { key: "medical", label: "医療・がん・就業不能・介護" },
  { key: "savings", label: "貯蓄型（個人年金・学資・外貨）" },
  { key: "nonlife", label: "損害保険（火災・地震・自動車）" },
  { key: "tanki",   label: "少額短期保険・生活付帯サービス" },
  { key: "group",   label: "団体保険（生協・勤務先経由）" },
];

/* ---- 保障の種類（重複チェックの横串キー） ---- */
const COVERAGE_KINDS = [
  { key: "death_lump",         label: "死亡一時金",        payout: "lump",    unit: "円" },
  { key: "death_monthly",      label: "死亡後の月額",      payout: "monthly", unit: "円/月" },
  { key: "high_severity_lump", label: "三大疾病等の一時金", payout: "lump",    unit: "円" },
  { key: "cancer_lump",        label: "がん診断一時金",    payout: "lump",    unit: "円" },
  { key: "hospital_daily",     label: "入院日額",          payout: "daily",   unit: "円/日" },
  { key: "outpatient_daily",   label: "通院日額",          payout: "daily",   unit: "円/日" },
  { key: "surgery",            label: "手術給付",          payout: "lump",    unit: "円" },
  { key: "advanced_medical",   label: "先進医療",          payout: "lump",    unit: "円" },
  { key: "disability_monthly", label: "就業不能の月額",    payout: "monthly", unit: "円/月" },
  { key: "nursing_lump",       label: "介護一時金",        payout: "lump",    unit: "円" },
  { key: "nursing_monthly",    label: "介護の月額",        payout: "monthly", unit: "円/月" },
  { key: "maturity",           label: "満期金・年金原資",  payout: "lump",    unit: "円" },
  { key: "property",           label: "物損・盗難",        payout: "lump",    unit: "円" },
  { key: "liability",          label: "賠償",              payout: "lump",    unit: "円" },
  { key: "accident",           label: "傷害（死亡・後遺障害・入通院）", payout: "lump", unit: "円" },
  { key: "expense",            label: "費用補償",          payout: "lump",    unit: "円" },
  { key: "legal",              label: "弁護士費用・法律相談", payout: "lump",  unit: "円" },
  { key: "service",            label: "サービス・現物の提供", payout: "none",   unit: "" },
];

/* ---- 保険の種類プリセット ----
 * suggest: この種類を選んだときに最初から並べる保障の行
 */
const PRODUCT_TYPES = [
  { key: "term_life",          label: "定期保険",      category: "life",    suggest: ["death_lump"] },
  { key: "whole_life",         label: "終身保険",      category: "life",    suggest: ["death_lump"] },
  { key: "income_protection",  label: "収入保障保険",  category: "life",    suggest: ["death_monthly"] },
  { key: "medical",            label: "医療保険",      category: "medical", suggest: ["hospital_daily", "surgery"] },
  { key: "cancer",             label: "がん保険",      category: "medical", suggest: ["cancer_lump"] },
  { key: "disability",         label: "就業不能保険",  category: "medical", suggest: ["disability_monthly"] },
  { key: "nursing",            label: "介護保険",      category: "medical", suggest: ["nursing_lump"] },
  { key: "personal_pension",   label: "個人年金保険",  category: "savings", suggest: ["maturity"] },
  { key: "education",          label: "学資保険",      category: "savings", suggest: ["maturity"] },
  { key: "fx_savings",         label: "外貨建保険",    category: "savings", suggest: ["maturity", "death_lump"] },
  { key: "fire",               label: "火災・地震保険", category: "nonlife", suggest: ["property"] },
  { key: "auto",               label: "自動車保険",    category: "nonlife", suggest: ["liability", "property"] },
  { key: "life_support",       label: "生活付帯サービス", category: "tanki",  suggest: ["service"] },
  { key: "group_plan",         label: "団体総合保障プラン", category: "group", suggest: ["accident", "liability"] },
  { key: "tanki_other",        label: "少額短期保険",   category: "tanki",   suggest: ["accident"] },
  { key: "other",              label: "その他",        category: "medical", suggest: [] },
];

/* ---- 保険料の支払サイクル（年額換算の係数） ---- */
const PREMIUM_CYCLES = [
  { key: "monthly",    label: "月払",   perYear: 12 },
  { key: "semiannual", label: "半年払", perYear: 2 },
  { key: "annual",     label: "年払",   perYear: 1 },
  { key: "lump",       label: "一時払", perYear: 0 },
];

/* ---- 会社の制度 ---- */
const COMPANY_BENEFIT_KINDS = [
  { key: "group_life",       label: "団体定期保険（群保）", expiresOnRetirement: true,  coverageKind: "death_lump" },
  { key: "group_medical",    label: "団体医療保険",         expiresOnRetirement: true,  coverageKind: "hospital_daily" },
  { key: "death_retirement", label: "死亡退職金",           expiresOnRetirement: false, coverageKind: "death_lump" },
  { key: "condolence",       label: "弔慰金",               expiresOnRetirement: false, coverageKind: "death_lump" },
  { key: "corporate_pension",label: "企業年金・DC",         expiresOnRetirement: false, coverageKind: "death_lump" },
  { key: "zaikei",           label: "財形貯蓄",             expiresOnRetirement: false, coverageKind: "death_lump" },
  { key: "stock",            label: "持株会",               expiresOnRetirement: false, coverageKind: "death_lump" },
];

/* ---- 公的給付 ---- */
const PUBLIC_BENEFIT_KINDS = [
  { key: "survivor_basic",    label: "遺族基礎年金",   scenario: "death" },
  { key: "survivor_employee", label: "遺族厚生年金",   scenario: "death" },
  { key: "widow_addition",    label: "中高齢寡婦加算", scenario: "death" },
  { key: "disability",        label: "障害年金",       scenario: "disability" },
  { key: "old_age",           label: "老齢年金",       scenario: "death" },
  { key: "sickness_allowance",label: "傷病手当金",     scenario: "illness" },
  { key: "other",             label: "その他",         scenario: "death" },
];

/* 新規作成時に並べる雛形。金額は未入力のまま出し、支給期間だけ既定値を入れておく。 */
const PUBLIC_BENEFIT_TEMPLATES = [
  { kind: "survivor_basic",    scenario: "death", annualAmount: 0,
    startCondition: "immediately", startValue: 0,
    endCondition: "youngest_child_18", endValue: 18,
    memo: "ねんきんネット等で調べた年額を入れてください" },
  { kind: "survivor_employee", scenario: "death", annualAmount: 0,
    startCondition: "immediately", startValue: 0,
    endCondition: "lifetime", endValue: 0,
    memo: "ねんきんネット等で調べた年額を入れてください" },
  { kind: "widow_addition",    scenario: "death", annualAmount: 0,
    startCondition: "at_age", startValue: 40,
    endCondition: "at_age", endValue: 65,
    memo: "配偶者が40〜65歳の間に加算される想定" },
];

const START_CONDITIONS = [
  { key: "immediately", label: "すぐに" },
  { key: "at_age",      label: "配偶者が◯歳から" },
  { key: "after_years", label: "◯年後から" },
];
const END_CONDITIONS = [
  { key: "youngest_child_18", label: "末子が◯歳になる年まで" },
  { key: "at_age",            label: "配偶者が◯歳まで" },
  { key: "lifetime",          label: "終身" },
];

/* ---- 資産 ---- */
const ASSET_KINDS = [
  { key: "savings",     label: "預貯金" },
  { key: "investment",  label: "NISA・株・投資信託" },
  { key: "retirement",  label: "退職金の見込み" },
  { key: "inheritance", label: "相続で入る見込み" },
];

/* ---- 教育費の目安（1人あたり・年額・円） ----
 *
 * 出典:
 *   幼稚園〜高校 … 文部科学省「子供の学習費調査（令和5年度）」の学習費総額
 *   大学         … 日本政策金融公庫「教育費負担の実態調査」の在学費用・入学費用
 *
 * いずれも概算。実際は地域・学校で幅があるため、画面から補正できるようにしてある。
 */
const EDUCATION_STAGES = [
  {
    key: "kindergarten", label: "幼稚園", fromAge: 3, toAge: 5,
    options: [
      { key: "public",  label: "公立", annual: 185000 },
      { key: "private", label: "私立", annual: 347000 },
    ],
  },
  {
    key: "elementary", label: "小学校", fromAge: 6, toAge: 11,
    options: [
      { key: "public",  label: "公立", annual: 336000 },
      { key: "private", label: "私立", annual: 1828000 },
    ],
  },
  {
    key: "junior", label: "中学校", fromAge: 12, toAge: 14,
    options: [
      { key: "public",  label: "公立", annual: 542000 },
      { key: "private", label: "私立", annual: 1560000 },
    ],
  },
  {
    key: "high", label: "高校", fromAge: 15, toAge: 17,
    options: [
      { key: "public",  label: "公立", annual: 598000 },
      { key: "private", label: "私立", annual: 1030000 },
    ],
  },
  {
    key: "university", label: "大学", fromAge: 18, toAge: 21,
    options: [
      { key: "none",            label: "進学しない",  annual: 0,       entry: 0 },
      { key: "national",        label: "国公立",      annual: 1030000, entry: 670000 },
      { key: "private_liberal", label: "私立文系",    annual: 1520000, entry: 810000 },
      { key: "private_science", label: "私立理系",    annual: 1830000, entry: 880000 },
    ],
  },
];

/* 補正値のキー: "<stageKey>:<optionKey>:annual" / ":entry" */
function eduKey(stageKey, optionKey, field) {
  return stageKey + ":" + optionKey + ":" + (field || "annual");
}

/* 内蔵値（補正前）を引く */
function eduBaseAmount(stageKey, optionKey, field) {
  const stage = EDUCATION_STAGES.find(s => s.key === stageKey);
  if (!stage) return 0;
  const opt = stage.options.find(o => o.key === optionKey);
  if (!opt) return 0;
  return (field === "entry" ? (opt.entry || 0) : (opt.annual || 0));
}

const HOKEN_DATA = {
  CATEGORIES, COVERAGE_KINDS, PRODUCT_TYPES, PREMIUM_CYCLES,
  COMPANY_BENEFIT_KINDS, PUBLIC_BENEFIT_KINDS, PUBLIC_BENEFIT_TEMPLATES,
  START_CONDITIONS, END_CONDITIONS, ASSET_KINDS, EDUCATION_STAGES,
  eduKey, eduBaseAmount,
};
