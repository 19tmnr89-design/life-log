/* もしもシミュレーションの計算エンジン
 *
 * 画面から切り離した純粋な計算だけを置く。金額はすべて「円」で扱う。
 *
 * 割り切り（要件定義 7.4 のとおり）:
 *  - 税金・社会保険料は考慮しない（税引前の金額）
 *  - 収入保障保険の逓減は再現せず「月額×12×支払期間」で計算する
 *  - 遺族年金の支給要件は判定せず、手入力された年額をそのまま使う
 */

/* -------- 保険料の年額換算 -------- */

function annualPremium(policy) {
  const p = (policy && policy.premium) || {};
  const cycle = HOKEN_DATA.PREMIUM_CYCLES.find(c => c.key === p.cycle);
  if (!cycle) return 0;
  return Math.round((p.amount || 0) * cycle.perYear);
}

/* 契約一覧の保険料集計。有効な契約だけを合計し、一時払は別枠にする。 */
function premiumSummary(data) {
  const policies = (data.policies || []).filter(p => p.status === "active");
  const byCategory = {};
  const byPolicy = [];
  let total = 0, lumpTotal = 0;

  for (const p of policies) {
    if (p.premium && p.premium.cycle === "lump") {
      lumpTotal += p.premium.amount || 0;
      byPolicy.push({ id: p.id, name: policyLabel(p), category: p.category, annual: 0, lump: p.premium.amount || 0 });
      continue;
    }
    const annual = annualPremium(p);
    total += annual;
    byCategory[p.category] = (byCategory[p.category] || 0) + annual;
    byPolicy.push({ id: p.id, name: policyLabel(p), category: p.category, annual: annual, lump: 0 });
  }
  byPolicy.sort((a, b) => b.annual - a.annual);
  return { total, lumpTotal, byCategory, byPolicy, count: policies.length };
}

function policyLabel(p) {
  return [p.insurer, p.productName].filter(Boolean).join(" ") || "(名称未設定)";
}

/* -------- 教育費 -------- */

function educationAmount(data, stageKey, optionKey, field) {
  const overrides = (data.household && data.household.educationCostOverrides) || {};
  const key = HOKEN_DATA.eduKey(stageKey, optionKey, field);
  if (overrides[key] != null && overrides[key] !== "") return Number(overrides[key]);
  return HOKEN_DATA.eduBaseAmount(stageKey, optionKey, field);
}

function stageForAge(age) {
  return HOKEN_DATA.EDUCATION_STAGES.find(s => age >= s.fromAge && age <= s.toAge) || null;
}

function coursePlanFor(child, stageKey) {
  const plan = (child && child.coursePlan) || {};
  if (plan[stageKey]) return plan[stageKey];
  return stageKey === "university" ? "national" : "public";
}

/* -------- 本体 -------- */

function simulate(data, opts) {
  opts = opts || {};
  const a = Object.assign({}, data.assumptions || {}, opts.assumptions || {});
  const hh = data.household || {};
  const sp = hh.spouse || {};
  const children = data.children || [];

  const baseYear = a.baseYear || new Date().getFullYear();
  const infl = num(a.inflationRate, 1) / 100;
  const ret = num(a.investmentReturn, 1) / 100;

  const spouseBirth = sp.birthYear || (data.profile && data.profile.birthYear) || (baseYear - 40);
  const spouseAge0 = baseYear - spouseBirth;

  let nYears = a.simulationYears;
  // 既定: 配偶者が90歳になる年まで（その年を含める）
  if (!nYears || nYears <= 0) nYears = Math.max(1, 90 - spouseAge0 + 1);
  nYears = Math.max(1, Math.min(nYears, 80));

  // 初期残高（いま使えるお金）
  let balance = 0;
  for (const as of data.assets || []) {
    if (as.availableAt === "now") balance += num(as.amount, 0);
  }
  const initialBalance = balance;

  const rows = [];
  let lumpAtStart = 0;        // 発生年に一度だけ入る一時金
  let recurringAtStart = 0;   // 発生年に「毎年続く形」で入るお金
  let depletionIndex = null;

  for (let t = 0; t < nYears; t++) {
    const year = baseYear + t;
    const spouseAge = spouseAge0 + t;
    const childAges = children.map(c => year - (c.birthYear || year));
    const youngestAge = childAges.length ? Math.min.apply(null, childAges) : null;
    const infFactor = Math.pow(1 + infl, t);

    /* ===== 入ってくるお金 ===== */
    const income = { insurance: 0, company: 0, pension: 0, spouse: 0, asset: 0 };
    let lumpThisYear = 0, recurringThisYear = 0;

    for (const p of data.policies || []) {
      if (p.status !== "active") continue;
      for (const cov of p.coverages || []) {
        if (cov.kind === "death_lump" && t === 0) {
          income.insurance += num(cov.amount, 0);
          lumpThisYear += num(cov.amount, 0);
        } else if (cov.kind === "death_monthly") {
          const term = Math.max(num(cov.termYears, 0), num(cov.minGuaranteeYears, 0)) || nYears;
          if (t < term) {
            income.insurance += num(cov.amount, 0) * 12;
            recurringThisYear += num(cov.amount, 0) * 12;
          }
        }
      }
    }

    for (const b of data.companyBenefits || []) {
      const amount = num(b.amount, 0);
      if (!amount) continue;
      if (b.payoutType === "lump") {
        if (t === 0) { income.company += amount; lumpThisYear += amount; }
      } else {
        const span = num(b.years, 0) || nYears;
        if (t < span) {
          const yearly = b.payoutType === "monthly" ? amount * 12 : amount;
          income.company += yearly;
          recurringThisYear += yearly;
        }
      }
    }

    for (const pb of data.publicBenefits || []) {
      if ((pb.scenario || "death") !== "death") continue;
      if (isBenefitActive(pb, t, spouseAge, youngestAge)) {
        income.pension += num(pb.annualAmount, 0);
        recurringThisYear += num(pb.annualAmount, 0);
      }
    }

    if (spouseAge <= num(sp.workUntilAge, 65)) {
      income.spouse += num(sp.incomeAfterEvent, 0);
      recurringThisYear += num(sp.incomeAfterEvent, 0);
    }

    for (const as of data.assets || []) {
      if (as.availableAt === "at_age" && spouseAge === num(as.ageValue, -1)) {
        income.asset += num(as.amount, 0);
        lumpThisYear += num(as.amount, 0);
      }
    }

    /* ===== 出ていくお金 ===== */
    const expense = { living: 0, housing: 0, education: 0, oneTime: 0 };

    const hasDependent = children.some((c, i) => childAges[i] < num(c.independenceAge, 22));
    const rate = (hasDependent ? num(hh.reduceRateWithChildren, 70) : num(hh.reduceRateAfterChildren, 50)) / 100;
    expense.living = num(hh.monthlyLivingCost, 0) * 12 * rate * infFactor;

    const ho = hh.housing || {};
    let housingMonthly = 0;
    if (ho.type === "loan") {
      // 死亡ケースでは団信ありならローン返済は消える
      if (!ho.hasGroupCredit && t < num(ho.remainingYears, 0)) housingMonthly += num(ho.monthlyPayment, 0);
      housingMonthly += num(ho.otherMonthlyCost, 0);
    } else if (ho.type === "rent") {
      housingMonthly += num(ho.monthlyPayment, 0);
    } else {
      housingMonthly += num(ho.otherMonthlyCost, 0);
    }
    expense.housing = housingMonthly * 12 * infFactor;

    children.forEach((c, i) => {
      const age = childAges[i];
      const stage = stageForAge(age);
      if (!stage) return;
      const opt = coursePlanFor(c, stage.key);
      expense.education += educationAmount(data, stage.key, opt, "annual") * infFactor;
      if (stage.key === "university" && age === stage.fromAge) {
        expense.education += educationAmount(data, stage.key, opt, "entry") * infFactor;
      }
    });

    if (t === 0) expense.oneTime += num(hh.funeralCost, 0);

    /* ===== 残高 ===== */
    const incomeTotal = sum(income);
    const expenseTotal = sum(expense);
    balance = balance + incomeTotal - expenseTotal;
    if (balance > 0) balance = balance * (1 + ret);

    if (t === 0) { lumpAtStart = lumpThisYear; recurringAtStart = recurringThisYear; }
    if (depletionIndex === null && balance < 0) depletionIndex = t;

    rows.push({
      t, year, spouseAge, childAges, youngestAge,
      income, incomeTotal, expense, expenseTotal,
      balance: Math.round(balance),
    });
  }

  return {
    baseYear, years: nYears, rows,
    initialBalance,
    summary: {
      lumpSum: Math.round(lumpAtStart),
      annualRecurring: Math.round(recurringAtStart),
      monthlyRecurring: Math.round(recurringAtStart / 12),
      depletionIndex,
      depletionYear: depletionIndex === null ? null : rows[depletionIndex].year,
      depletionSpouseAge: depletionIndex === null ? null : rows[depletionIndex].spouseAge,
      finalBalance: rows.length ? rows[rows.length - 1].balance : 0,
      finalYear: rows.length ? rows[rows.length - 1].year : baseYear,
    },
  };
}

function isBenefitActive(pb, t, spouseAge, youngestAge) {
  let started;
  if (pb.startCondition === "at_age") started = spouseAge >= num(pb.startValue, 0);
  else if (pb.startCondition === "after_years") started = t >= num(pb.startValue, 0);
  else started = true;

  let ended;
  if (pb.endCondition === "at_age") ended = spouseAge >= num(pb.endValue, 200);
  else if (pb.endCondition === "youngest_child_18") {
    ended = youngestAge === null ? true : youngestAge > num(pb.endValue, 18);
  } else ended = false; // lifetime

  return started && !ended;
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function sum(obj) {
  let v = 0;
  for (const k in obj) v += obj[k];
  return v;
}

const HOKEN_SIM = {
  simulate, annualPremium, premiumSummary, policyLabel,
  educationAmount, stageForAge, coursePlanFor,
};
