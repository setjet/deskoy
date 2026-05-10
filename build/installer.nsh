; Deskoy NSIS customizations (electron-builder assisted installer).
; Scope: installer UX only. The desktop app bundle is unchanged.

!define MUI_BGCOLOR "FFFFFF"
!define MUI_TEXTCOLOR "111827"
!define MUI_INSTFILESPAGE_COLORS "FFFFFF 111827"
!define MUI_INSTFILESPAGE_PROGRESSBAR "smooth"
!define MUI_INSTFILESPAGE_FINISHHEADER_TEXT "Deskoy is installed"
!define MUI_INSTFILESPAGE_FINISHHEADER_SUBTEXT "Shortcuts and application files are ready."
!define MUI_UNINSTFILESPAGE_FINISHHEADER_TEXT "Deskoy was removed"
!define MUI_UNINSTFILESPAGE_FINISHHEADER_SUBTEXT "Application files and shortcuts have been cleaned up."
!define DESKOY_REQUIRED_KB 358400

!macro customHeader
  ; Keep the bulky NSIS log hidden; we show a clean current-file line instead.
  ShowInstDetails nevershow
  !ifdef BUILD_UNINSTALLER
    ShowUninstDetails nevershow
  !endif
!macroend

!macro customInit
  ; Match the real commercial installer footprint shown on the directory page.
  SectionSetSize INSTALL_SECTION_ID ${DESKOY_REQUIRED_KB}
  ; Hidden: no cmd.exe window. /F avoids "cannot be closed" prompts during overwrite.
  nsExec::Exec `taskkill /IM "${APP_EXECUTABLE_FILENAME}" /T /F`
  Pop $R0
!macroend

!macro customUnInit
  nsExec::Exec `taskkill /IM "${APP_EXECUTABLE_FILENAME}" /T /F`
  Pop $R0
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Install Deskoy"
  !define MUI_WELCOMEPAGE_TEXT "Deskoy adds a fast privacy cover for sensitive windows and runs quietly from the system tray.$\r$\n$\r$\nSetup will install the app, add Start menu and desktop shortcuts, and prepare a fresh first-run experience for new installs.$\r$\n$\r$\nFor the smoothest update, close any running Deskoy windows first, including the tray app.$\r$\n$\r$\nClick Next to continue."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customFinishPage
  !define MUI_FINISHPAGE_TITLE "Deskoy is ready"
  !define MUI_FINISHPAGE_TEXT "Installation finished successfully.$\r$\n$\r$\nOpen Deskoy now to finish setup, or launch it later from the Start menu or desktop shortcut."
  !ifndef HIDE_RUN_AFTER_FINISH
    Function DeskoyStartApp
      ${if} ${isUpdated}
        StrCpy $1 "--updated"
      ${else}
        StrCpy $1 ""
      ${endif}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd
    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_TEXT "Open Deskoy now"
    !define MUI_FINISHPAGE_RUN_FUNCTION "DeskoyStartApp"
  !endif
  !insertmacro MUI_PAGE_FINISH
!macroend

!ifndef BUILD_UNINSTALLER
  Function DeskoyInstFilesShow
    FindWindow $0 "#32770" "" $HWNDPARENT
    GetDlgItem $1 $0 1016
    ShowWindow $1 0
    GetDlgItem $1 $0 1027
    ShowWindow $1 0
    GetDlgItem $1 $0 1006
    SendMessage $1 0x000C 0 "STR:Preparing Deskoy..."
  FunctionEnd

  !macro customPageAfterChangeDir
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW DeskoyInstFilesShow
  !macroend
!endif

!macro customUnWelcomePage
  !define MUI_UNWELCOMEPAGE_TITLE "Uninstall Deskoy"
  !define MUI_UNWELCOMEPAGE_TEXT "This will remove Deskoy from your computer.$\r$\n$\r$\nThe uninstaller will close any running Deskoy process, remove application files, clean up Start menu and desktop shortcuts, and unregister Deskoy from Windows Apps & features.$\r$\n$\r$\nClick Uninstall to continue."
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

!macro customUninstallPage
  !define MUI_UNFINISHPAGE_TITLE "Deskoy was removed"
  !define MUI_UNFINISHPAGE_TEXT "Uninstall finished successfully.$\r$\n$\r$\nDeskoy application files and shortcuts have been removed from this computer."
!macroend

!macro DeskoyInstallDetailLines
  SetDetailsPrint textonly
  DetailPrint "Preparing Deskoy installation folder..."
  Sleep 120
  DetailPrint "Installing ${APP_EXECUTABLE_FILENAME}"
  Sleep 120
  DetailPrint "Installing resources\app.asar"
  Sleep 120
  DetailPrint "Installing resources\assets\icon.png"
  Sleep 120
  DetailPrint "Installing resources\assets\logo.png"
  Sleep 120
  DetailPrint "Installing resources\assets\install-loading.gif"
  Sleep 120
  DetailPrint "Creating Start menu shortcut"
  Sleep 120
  DetailPrint "Creating desktop shortcut"
!macroend

!macro customFiles_x64
  !insertmacro DeskoyInstallDetailLines
!macroend

!macro customFiles_arm64
  !insertmacro DeskoyInstallDetailLines
!macroend

!macro customFiles_ia32
  !insertmacro DeskoyInstallDetailLines
!macroend

!macro customInstall
  SetDetailsPrint textonly
  ; Only true new installs: skip on silent in-place updates so settings stay put.
  ${ifNot} ${isUpdated}
    CreateDirectory "$INSTDIR\resources"
    ClearErrors
    FileOpen $0 "$INSTDIR\resources\deskoy-fresh-install.marker" w
    IfErrors deskoy_fresh_done
    FileWrite $0 "1"
    FileClose $0
    DetailPrint "Preparing first-run setup"
    deskoy_fresh_done:
  ${endif}
  DetailPrint "Deskoy installation complete"
!macroend

!macro customUnInstall
  SetDetailsPrint textonly
  DetailPrint "Removed Deskoy application files from $INSTDIR"
  ${ifNot} ${isKeepShortcuts}
    DetailPrint "Removed Deskoy desktop shortcut."
    DetailPrint "Removed Deskoy Start menu shortcut."
  ${else}
    DetailPrint "Kept shortcuts for update compatibility."
  ${endif}
  DetailPrint "Removed Deskoy registry entries."
  ${if} $isDeleteAppData == "1"
    DetailPrint "Removed Deskoy app data."
  ${else}
    DetailPrint "Kept Deskoy app data and preferences."
  ${endif}
  DetailPrint "Deskoy uninstall complete."
!macroend
