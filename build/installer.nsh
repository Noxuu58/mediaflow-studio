; Included automatically by electron-builder's NSIS target.

; Runs after the shortcuts are created. Updates keep existing shortcuts as they are, so:
; - point them back at the installed app: a Start Menu shortcut aimed at an old portable copy (in %TEMP%) made
;   "Restart & Install" relaunch that old copy, so the update looked like it did nothing (fix in 1.2.4);
; - stamp the current AppUserModelID (build.appId) on them: the taskbar uses it to pick the app's icon (fix in 1.0.1).
; A shortcut the user deleted is not recreated.
!macro customInstall
  ${if} ${FileExists} "$newStartMenuLink"
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  ${endIf}
  ${if} ${FileExists} "$newDesktopLink"
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${endIf}
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

; Always install for the current user only: no "all users / just me" question and no admin prompt.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend
