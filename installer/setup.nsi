Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"
Name "寄信模式"
OutFile "..\release\SendModes-Setup-1.6.2.exe"
InstallDir "$LOCALAPPDATA\Programs\SendModes"
RequestExecutionLevel user
SetCompressor /SOLID lzma
VIProductVersion "1.6.2.0"
VIAddVersionKey "ProductName" "寄信模式"
VIAddVersionKey "FileDescription" "寄信模式 Windows 安裝程式"
VIAddVersionKey "FileVersion" "1.6.2"
VIAddVersionKey "LegalCopyright" "Includes open-source components; see THIRD-PARTY-NOTICES.txt"
Var ExtractOnly
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "安裝本機 HTTPS 服務與寄信模式，登入 Windows 後自動啟動。$\r$\n$\r$\nWindows 會詢問是否信任 localhost 憑證，請確認後按「是」。此憑證僅供這台電腦的本機連線使用，只加入目前 Windows 帳戶。$\r$\n$\r$\n不需安裝 Node.js。Outlook 首次加入增益集請依安裝後視窗操作；IT 已集中部署時可直接使用。"
!define MUI_FINISHPAGE_RUN "$INSTDIR\SendModes.exe"
!define MUI_FINISHPAGE_RUN_TEXT "開啟寄信模式設定"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "TradChinese"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "需要 64 位元 Windows 10 或更新版本。"
    Abort
  ${EndIf}
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/EXTRACTONLY" $1
  ${IfNot} ${Errors}
    StrCpy $ExtractOnly "1"
  ${EndIf}
FunctionEnd

Section "寄信模式"
  SetShellVarContext current
  ${If} $ExtractOnly != "1"
    ${If} ${FileExists} "$INSTDIR\SendModes.exe"
      ExecWait '"$INSTDIR\SendModes.exe" --stop' $0
      ${If} $0 != 0
        MessageBox MB_ICONSTOP "無法停止舊版本，請關閉寄信模式設定視窗後重試。" /SD IDOK
        Abort
      ${EndIf}
    ${EndIf}
  ${EndIf}
  SetOutPath "$INSTDIR"
  File /r "..\.runtime\installer-stage\*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  ${If} $ExtractOnly == "1"
    FileOpen $0 "$INSTDIR\extraction-only" w
    FileClose $0
    Goto done
  ${EndIf}
  CreateDirectory "$SMPROGRAMS\寄信模式"
  CreateShortcut "$SMPROGRAMS\寄信模式\寄信模式.lnk" "$INSTDIR\SendModes.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OutlookSendModes" "DisplayName" "寄信模式"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OutlookSendModes" "DisplayVersion" "1.6.2"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OutlookSendModes" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OutlookSendModes" "DisplayIcon" "$INSTDIR\SendModes.exe"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OutlookSendModes" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OutlookSendModes" "NoRepair" 1
  DetailPrint "正在啟動本機服務（最多兩分鐘）。若出現 localhost 憑證視窗，請確認後回覆。"
  ExecWait '"$INSTDIR\SendModes.exe" --install' $0
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION "程式檔案已安裝，但本機服務尚未就緒。請按「診斷／測試本機」查看結果；若未通過，請重新執行安裝程式。" /SD IDOK
    SetErrorLevel 1
  ${EndIf}
  done:
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  IfFileExists "$INSTDIR\extraction-only" files
  ExecWait '"$INSTDIR\SendModes.exe" --remove' $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "無法完成服務或憑證清理。請關閉寄信模式設定視窗，再重試解除安裝。" /SD IDOK
    Abort
  ${EndIf}
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OutlookSendModes"
  Delete "$SMPROGRAMS\寄信模式\寄信模式.lnk"
  RMDir "$SMPROGRAMS\寄信模式"
  files:
  !include "..\.runtime\installer-delete.nsh"
  Delete "$INSTDIR\extraction-only"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
