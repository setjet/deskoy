!macro NSIS_HOOK_POSTINSTALL
  IfFileExists "$DESKTOP\${PRODUCTNAME}.lnk" 0 done_desktop_shortcut_icon
    Delete "$DESKTOP\${PRODUCTNAME}.lnk"
    CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\_up_\assets\icon.ico" 0
    !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
  done_desktop_shortcut_icon:

  IfFileExists "$SMPROGRAMS\${PRODUCTNAME}.lnk" 0 done_start_shortcut_icon
    Delete "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\_up_\assets\icon.ico" 0
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  done_start_shortcut_icon:

  ; Add the separate CLI directory, never the application executable directory.
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\_up_\cli\install-path.ps1" -Action Add -CliDirectory "$INSTDIR\_up_\cli"'
  Pop $0
  ${If} $0 != 0
    DetailPrint "Deskoy CLI PATH setup failed (exit $0). The desktop app is installed normally."
  ${EndIf}
  System::Call 'user32::SendMessageTimeoutW(p 0xffff, i 0x1A, p 0, w "Environment", i 2, i 5000, *p .r0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\_up_\cli\install-path.ps1" -Action Remove -CliDirectory "$INSTDIR\_up_\cli"'
  Pop $0
  ${If} $0 != 0
    DetailPrint "Deskoy CLI PATH cleanup failed (exit $0)."
  ${EndIf}
  System::Call 'user32::SendMessageTimeoutW(p 0xffff, i 0x1A, p 0, w "Environment", i 2, i 5000, *p .r0)'
!macroend
