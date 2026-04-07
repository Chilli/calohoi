const { KASSAL_BASE_URL, getApiKey, json, mapBarcodeProduct } = require('./_kassal.cjs')

module.exports.handler = async (event) => {
  const apiKey = getApiKey()
  if (!apiKey) {
    return json(500, { error: 'KASSAL_API_KEY is not configured' })
  }

  const path = String(event.path || '')
  const ean = decodeURIComponent(path.split('/').filter(Boolean).pop() || '').replace(/\D/g, '')
  if (!ean) {
    return json(400, { error: 'Missing EAN' })
  }

  const url = `${KASSAL_BASE_URL}/products/ean/${encodeURIComponent(ean)}`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })

  if (res.status === 404) {
    return json(404, { error: 'Not found' })
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return json(res.status >= 500 ? 502 : res.status, {
      error: 'Kassal lookup failed',
      status: res.status,
      body: body.slice(0, 500),
    })
  }

  const data = await res.json()
  const product = mapBarcodeProduct(data?.data)

  if (!product) {
    return json(404, { error: 'Not found' })
  }

  return json(200, product)
}
