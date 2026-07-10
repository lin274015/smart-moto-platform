function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function roundTwd(value) {
  return Math.round((Number(value) || 0) + 1e-9);
}

export function calculateQuote(input) {
  const markupRate = Number(input.markupRate || 1.15);
  const costRate = Number(input.costRate || 0.85);
  const parts = (input.parts || []).map((item, index) => {
    const quantity = Number(item.quantity || 0);
    const listPrice = Number(item.listPrice || 0);
    const quotePrice = roundTwd(item.quotePrice ?? listPrice * markupRate);
    const total = roundTwd(quantity * quotePrice);
    const costTotal = roundMoney(quantity * listPrice * costRate);
    const grossProfit = roundTwd(total - costTotal);

    return {
      line: index + 1,
      partNo: item.partNo || "",
      name: item.name || "",
      quantity,
      listPrice,
      quotePrice,
      total,
      costTotal,
      grossProfit,
      damage: item.damage || ""
    };
  });

  const generatedFees = [];
  const laborHours = Number(input.laborHours || input.labor?.hours || 0);
  const laborRate = Number(input.laborRate || input.labor?.rate || 0);
  const inspectionFee = Number(input.inspectionFee || 0);
  const towingFee = Number(input.towingFee || 0);
  const otherFee = Number(input.otherFee || 0);

  if (laborHours > 0 && laborRate > 0) {
    generatedFees.push({
      name: "維修工資",
      quantity: laborHours,
      unitPrice: laborRate,
      note: `${laborHours} 小時 x ${laborRate}`,
      category: "labor"
    });
  }

  if (inspectionFee > 0) {
    generatedFees.push({ name: "檢查費", quantity: 1, unitPrice: inspectionFee, note: "", category: "service" });
  }

  if (towingFee > 0) {
    generatedFees.push({ name: "道路救援/拖吊", quantity: 1, unitPrice: towingFee, note: "", category: "service" });
  }

  if (otherFee > 0) {
    generatedFees.push({ name: "其他費用", quantity: 1, unitPrice: otherFee, note: "", category: "service" });
  }

  const otherFees = [...generatedFees, ...(input.otherFees || [])].map((item, index) => {
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice || 0);
    return {
      line: index + 1,
      name: item.name || "",
      quantity,
      unitPrice,
      total: roundTwd(quantity * unitPrice),
      note: item.note || "",
      category: item.category || "service"
    };
  });

  const materialTotal = roundTwd(parts.reduce((sum, item) => sum + item.total, 0));
  const materialCostTotal = roundMoney(parts.reduce((sum, item) => sum + item.costTotal, 0));
  const grossProfitTotal = roundTwd(parts.reduce((sum, item) => sum + item.grossProfit, 0));
  const laborTotal = roundTwd(otherFees.filter((item) => item.category === "labor").reduce((sum, item) => sum + item.total, 0));
  const serviceFeeTotal = roundTwd(otherFees.filter((item) => item.category !== "labor").reduce((sum, item) => sum + item.total, 0));
  const otherFeeTotal = roundTwd(otherFees.reduce((sum, item) => sum + item.total, 0));
  const repairEventTotal = roundTwd(materialTotal + otherFeeTotal);

  return {
    vehicle: input.vehicle || {},
    parts,
    otherFees,
    totals: {
      materialTotal,
      materialCostTotal,
      grossProfitTotal,
      laborTotal,
      serviceFeeTotal,
      otherFeeTotal,
      repairEventTotal,
      grandTotal: repairEventTotal
    }
  };
}
