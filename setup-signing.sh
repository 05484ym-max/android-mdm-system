#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

cd ~/android-mdm-system
rm -f dpc-signing.b64

echo "--- [1/5] checking keytool ---"
command -v keytool

if [ -f dpc-signing.jks ]; then
  echo "ERROR: dpc-signing.jks already exists. Refusing to overwrite it."
  echo "If you want a fresh key, move the old one aside first."
  exit 1
fi

KS_PASS=$(openssl rand -hex 16)
echo "--- [2/5] KEYSTORE PASSWORD (SAVE THIS): $KS_PASS ---"

echo "--- [3/5] generating keystore ---"
keytool -genkeypair -keystore dpc-signing.jks -storetype PKCS12 \
  -alias dpc -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "$KS_PASS" -keypass "$KS_PASS" \
  -dname "CN=MDM DPC, O=MDM, C=IL"
keytool -list -keystore dpc-signing.jks -storepass "$KS_PASS"

echo "--- [4/5] encoding ---"
base64 -w 0 dpc-signing.jks > dpc-signing.b64
echo "base64 size: $(wc -c < dpc-signing.b64) bytes"
if [ ! -s dpc-signing.b64 ]; then echo "ERROR: base64 file is empty"; exit 1; fi

echo "--- [5/5] uploading secrets ---"
gh secret set ANDROID_KEYSTORE_B64 < dpc-signing.b64
gh secret set ANDROID_KEYSTORE_PASSWORD --body "$KS_PASS"
gh secret set ANDROID_KEY_ALIAS --body "dpc"
rm -f dpc-signing.b64

echo ""
gh secret list
echo ""
echo "=== SUCCESS. Keystore password: $KS_PASS ==="
