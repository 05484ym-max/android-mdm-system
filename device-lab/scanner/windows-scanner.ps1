param([string]$Server = $env:LAB_SERVER_URL,[string]$Key = $env:LAB_ADMIN_KEY)
$ErrorActionPreference = "SilentlyContinue"
function Adb($a) { ((& adb $a 2>$null) -join "`n") }
function Prop($n) { (Adb @("shell","getprop",$n)).Trim() }
function FastbootVar($n) {
  $out = ((& fastboot getvar $n 2>&1) -join "`n")
  $line = $out -split "`r?`n" | Where-Object { $_ -match ("^" + [regex]::Escape($n) + "\s*:") } | Select-Object -First 1
  if ($line) { return ($line -replace ("^" + [regex]::Escape($n) + "\s*:\s*"), "").Trim() }
  return $null
}
$usb = Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPClass -eq "USB" -or $_.DeviceID -like "USB*" } | Select-Object -First 50 Name,DeviceID,Manufacturer,Status
$drivers = Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceClass -eq "USB" -or $_.DeviceName -match "Android|Qualcomm|MediaTek|ADB|Fastboot" } | Select-Object -First 100 DeviceName,DriverVersion,Manufacturer,InfName
$owner = Adb @("shell","dpm","list","owners")
$setup = Adb @("shell","cmd","package","resolve-activity","--brief","-a","android.intent.action.MAIN","-c","android.intent.category.SETUP_WIZARD")
$payload = @{
 source="windows-scanner"; hostType="WINDOWS"; capturedAt=(Get-Date).ToUniversalTime().ToString("o");
 adbSerial=(Adb @("get-serialno")).Trim(); adbState=(Adb @("get-state")).Trim();
 properties=@{manufacturer=Prop "ro.product.manufacturer";brand=Prop "ro.product.brand";model=Prop "ro.product.model";product=Prop "ro.product.name";device=Prop "ro.product.device";board=Prop "ro.product.board";hardware=Prop "ro.hardware";platform=Prop "ro.board.platform";cpuAbi=Prop "ro.product.cpu.abi";androidVersion=Prop "ro.build.version.release";apiLevel=Prop "ro.build.version.sdk";buildFingerprint=Prop "ro.build.fingerprint";buildId=Prop "ro.build.id";buildIncremental=Prop "ro.build.version.incremental";securityPatch=Prop "ro.build.version.security_patch";bootloader=Prop "ro.bootloader";verifiedBootState=Prop "ro.boot.verifiedbootstate";flashLocked=Prop "ro.boot.flash.locked";slotSuffix=Prop "ro.boot.slot_suffix";dynamicPartitions=Prop "ro.boot.dynamic_partitions"};
 setupWizardPackage=$setup.Trim(); deviceOwner=$owner.Trim();
 fastboot=@{product=FastbootVar "product";unlocked=FastbootVar "unlocked";secure=FastbootVar "secure";currentSlot=FastbootVar "current-slot"};
 hostEvidence=@{usbDevices=$usb;drivers=$drivers}
}
$json=$payload | ConvertTo-Json -Depth 8
$json
if ($Server -and $Key) { Invoke-RestMethod -Method Post -Uri ($Server.TrimEnd("/") + "/api/lab/scans") -Headers @{"x-lab-key"=$Key} -ContentType "application/json" -Body $json | ConvertTo-Json -Depth 8 }