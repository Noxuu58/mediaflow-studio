; Included automatically by electron-builder's NSIS target.
; Always install for the current user only: no "all users / just me" question and no admin prompt.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend
