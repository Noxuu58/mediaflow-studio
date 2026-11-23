; Included automatically by electron-builder's NSIS target.

; Runs after the shortcuts are created. Updates keep existing shortcuts, so stamp the current
; AppUserModelID (build.appId) on them too: the taskbar uses it to pick the app's icon (fix in 1.0.1).
!macro customInstall
  ${if} ${FileExists} "$newStartMenuLink"
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  ${endIf}
  ${if} ${FileExists} "$newDesktopLink"
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${endIf}
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

; Always install for the current user only: no "all users / just me" question and no admin prompt.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend
