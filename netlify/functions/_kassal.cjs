const KASSAL_BASE_URL = 'https://kassal.app/api/v1'

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  }
}

function getApiKey() {
  const key = process.env.KASSAL_API_KEY || process.env.VITE_KASSAL_API_KEY || ''
  return key.trim()
}

function parseKassalNutrition(nutrition) {
  const list = Array.isArray(nutrition) ? nutrition : []
  const get = (code) => {
    const item = list.find((n) => n && n.code === code)
    return item ? item.amount : undefined
  }

  return {
    caloriesKcal: get('energi_kcal') ?? (get('energi_kj') != null ? Math.round(get('energi_kj') / 4.184) : undefined),
    proteinG: get('protein'),
    carbsG: get('karbohydrater'),
    fatG: get('fett_totalt'),
    fiberG: get('kostfiber'),
  }
}

function mapSearchProduct(product) {
  if (!product || typeof product !== 'object') return null
  const p = product
  const nutritionRaw = Array.isArray(p.nutrition) ? p.nutrition : []
  const nutrients = parseKassalNutrition(nutritionRaw)

  if (nutrients.caloriesKcal == null && nutritionRaw.length === 0) return null

  return {
    code: `kassal-${String(p.id ?? '')}`,
    productName: String(p.name ?? '').trim() || 'Unknown product',
    brands: typeof p.brand === 'string' ? p.brand.trim() || undefined : undefined,
    imageUrl: typeof p.image === 'string' ? p.image : undefined,
    source: 'kassal',
    nutrimentsPer100g: nutrients,
  }
}

function mapBarcodeProduct(data) {
  if (!data || typeof data !== 'object') return null
  const d = data
  const nutritionRaw = Array.isArray(d.nutrition) ? d.nutrition : []
  const nutrients = parseKassalNutrition(nutritionRaw)
  const firstProduct = Array.isArray(d.products) && d.products.length > 0 ? d.products[0] : null
  const name = firstProduct ? String(firstProduct.name ?? '').trim() : ''
  if (!name) return null

  return {
    code: String(d.ean ?? ''),
    productName: name,
    brands: firstProduct && typeof firstProduct.brand === 'string' ? firstProduct.brand.trim() || undefined : undefined,
    imageUrl: firstProduct && typeof firstProduct.image === 'string' ? firstProduct.image : undefined,
    source: 'kassal',
    nutrimentsPer100g: nutrients,
  }
}

module.exports = {
  KASSAL_BASE_URL,
  getApiKey,
  json,
  mapBarcodeProduct,
  mapSearchProduct,
  parseKassalNutrition,
}
