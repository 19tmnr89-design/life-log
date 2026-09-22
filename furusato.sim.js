/* ふるさと納税 上限額シミュレーション — 計算エンジン
 *
 * 画面から切り離した純粋な計算だけを置く。金額はすべて「円」で扱う。
 * 対象は給与所得者本人のみ、確定申告をしない（ワンストップ特例）前提。
 *
 * 割り切り（正直に書いておく）:
 *  - 本人・配偶者以外の所得（事業所得・不動産所得など）は考慮しない
 *  - 配偶者は給与所得者として、年収から給与所得控除で所得を計算する
 *  - 老人控除対象配偶者・障害者控除・ひとり親控除などは考慮しない
 *  - 生命保険料控除・地震保険料控除・iDeCo・住宅ローン控除などは考慮しない
 *    （「特になし」という回答を踏まえた前提。該当する年は上限がこの計算より下がる）
 *  - 住民税の調整控除（人的控除差調整）は実際の式で計算するが、
 *    基礎控除・配偶者控除・扶養控除の人的控除差のみを対象とする
 */

const FD = FURUSATO_DATA;

function n(v, fb) {
  const x = Number(v);
  return Number.isFinite(x) ? x : (fb === undefined ? 0 : fb);
}

/* 1000円未満切り捨て */
function floor1000(v) {
  return Math.floor(Math.max(0, v) / 1000) * 1000;
}

/* ---- 世帯情報から控除額一式を計算する ---- */

function computeDeductions(household, totalIncomeAfterAdjustment) {
  const A = totalIncomeAfterAdjustment; // 本人の合計所得金額（配偶者控除等の判定に使う）
  const out = { income: {}, resident: {} };

  ["income", "resident"].forEach(kind => {
    const basic = FD.basicDeduction(A, kind);
    const spouse = household.hasSpouse
      ? FD.totalSpouseDeduction(A, n(household.spouseAnnualIncome), kind)
      : 0;
    const dependents = FD.dependentDeduction(household.dependents || {}, kind);
    out[kind] = { basic, spouse, dependents };
  });

  return out;
}

/* ---- メインの計算 ----
 * income: { salary, bonus, insurance } … 年間合計（円）
 * household: { hasSpouse, spouseAnnualIncome, hasUnder23Dependent, dependents:{general,specific,elderlyWith,elderlyOther} }
 */
function calcLimit(income, household) {
  const grossIncome = n(income.salary) + n(income.bonus); // 給与収入（年間）
  const insurance = n(income.insurance); // 社会保険料控除（全額）

  const employmentDeduction = FD.employmentIncomeDeduction(grossIncome);
  const employmentIncome = Math.max(0, grossIncome - employmentDeduction);

  const hasQualifyingDependent = !!household.hasUnder23Dependent;
  const adjustment = FD.incomeAdjustmentDeduction(grossIncome, hasQualifyingDependent);
  const incomeAfterAdjustment = Math.max(0, employmentIncome - adjustment);

  const ded = computeDeductions(household, incomeAfterAdjustment);

  const taxableIncomeTax = floor1000(
    incomeAfterAdjustment - insurance - ded.income.basic - ded.income.spouse - ded.income.dependents);
  const taxableResident = floor1000(
    incomeAfterAdjustment - insurance - ded.resident.basic - ded.resident.spouse - ded.resident.dependents);

  const bracket = FD.incomeTaxBracket(taxableIncomeTax);
  const incomeTaxRate = bracket.rate;
  const incomeTax = Math.max(0, Math.round(taxableIncomeTax * bracket.rate - bracket.deduct));

  // 住民税の調整控除（人的控除差調整）。基礎控除・配偶者控除・扶養控除の人的控除差の合計に基づく。
  const personalDiff = personalDeductionDiff(household, incomeAfterAdjustment);
  let residentAdjustment;
  if (taxableResident <= 2000000) {
    residentAdjustment = Math.round(Math.min(personalDiff, taxableResident) * 0.05);
  } else {
    residentAdjustment = Math.max(2500, Math.round((personalDiff - (taxableResident - 2000000)) * 0.05));
  }

  const residentIncomeLevy = Math.max(0, Math.round(taxableResident * FD.RESIDENT_TAX_RATE) - residentAdjustment);

  // ふるさと納税の上限額（総務省の計算式）
  const denom = 0.9 - incomeTaxRate * FD.RECONSTRUCTION_SURTAX_RATE;
  const limit = denom > 0
    ? Math.floor(residentIncomeLevy * 0.2 / denom) + 2000
    : 0;

  return {
    grossIncome, employmentDeduction, employmentIncome,
    adjustment, incomeAfterAdjustment,
    deductions: ded, insurance,
    taxableIncomeTax, taxableResident,
    incomeTaxRate, incomeTax,
    residentAdjustment, residentIncomeLevy,
    limit: Math.max(0, limit),
  };
}

/* 人的控除差（基礎控除・配偶者控除・扶養控除の所得税額と住民税額の差の合計） */
function personalDeductionDiff(household, taxpayerIncome) {
  let diff = 50000; // 基礎控除の差（48万-43万）は常に一定
  if (household.hasSpouse) {
    const spouseIncome = n(household.spouseAnnualIncome) > 0
      ? Math.max(0, n(household.spouseAnnualIncome) - FD.employmentIncomeDeduction(n(household.spouseAnnualIncome)))
      : 0;
    if (spouseIncome <= 480000) {
      // 配偶者控除の人的控除差（本人所得区分に応じて5万/4万/2万）
      diff += taxpayerIncome <= 9000000 ? 50000 : taxpayerIncome <= 9500000 ? 40000 : 20000;
    } else if (spouseIncome <= 1000000) {
      // 配偶者特別控除のうち、所得38万円未満のみ人的控除差の対象（簡略化: 上の帯と同じ差を採用）
      diff += taxpayerIncome <= 9000000 ? 50000 : taxpayerIncome <= 9500000 ? 40000 : 20000;
    }
  }
  const dep = household.dependents || {};
  diff += (dep.general || 0) * 50000;
  diff += (dep.specific || 0) * 180000;
  diff += (dep.elderlyWith || 0) * 130000;
  diff += (dep.elderlyOther || 0) * 100000;
  return diff;
}

/* ---- 寄付記録の集計 ---- */

function donationSummary(donations, year) {
  const rows = (donations || []).filter(d => d.year === year);
  const total = rows.reduce((s, d) => s + n(d.amount), 0);
  const municipalities = new Set(rows.map(d => (d.municipality || "").trim()).filter(Boolean));
  const oneStopDone = rows.filter(d => d.oneStop).length;
  return { rows, total, municipalityCount: municipalities.size, count: rows.length, oneStopDone };
}

/* ---- 年間収入の集計 ---- */

function incomeSummary(incomeRows, year) {
  const rows = (incomeRows || []).filter(r => r.year === year);
  const salary = rows.reduce((s, r) => s + n(r.salary), 0);
  const bonus = rows.reduce((s, r) => s + n(r.bonus), 0);
  const insurance = rows.reduce((s, r) => s + n(r.insurance), 0);
  const monthsEntered = rows.filter(r => n(r.salary) > 0 || n(r.bonus) > 0).length;
  return { salary, bonus, insurance, monthsEntered, rows };
}

const FURUSATO_SIM = { calcLimit, computeDeductions, donationSummary, incomeSummary, floor1000 };
