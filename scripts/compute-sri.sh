#!/usr/bin/env bash
# ============================================================
# scripts/compute-sri.sh — v7.5 #23
# ============================================================
# يحسب SHA-384 hashes لكل CDN scripts في index.html
# ثم تُنسخ يدوياً إلى integrity="..." crossorigin="anonymous"
#
# الاستخدام:
#   bash scripts/compute-sri.sh
# ============================================================

set -euo pipefail

URLS=(
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js"
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js"
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js"
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js"
  "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"
  "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"
)

echo "🔐 حساب SRI hashes (SHA-384) لكل CDN script..."
echo ""

for url in "${URLS[@]}"; do
  echo "📦 $url"
  HASH=$(curl -fsSL "$url" | openssl dgst -sha384 -binary | openssl base64 -A)
  echo "   integrity=\"sha384-${HASH}\" crossorigin=\"anonymous\""
  echo ""
done

echo ""
echo "✅ انتهى. انسخ الـ integrity attributes إلى public/index.html"
echo "   ⚠️ كلما حُدِّثت أرقام إصدارات المكتبات، يجب إعادة تشغيل هذا السكربت."
