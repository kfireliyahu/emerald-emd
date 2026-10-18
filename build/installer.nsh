; What the Windows uninstaller does beyond electron-builder's own (M45 F3, D-457).
;
; Emerald keeps the copies it takes before a write in a per-user folder of its own,
; %LOCALAPPDATA%\Emerald\Backups (backupsRoot in electron/bridge.ts). Uninstalling
; the app takes that folder with it, and Emerald's folder too when nothing else is
; left in it. Never on an update: electron-builder runs the old uninstaller silently
; when a new version installs, and an update must not throw away anybody's copies.
;
; The documents themselves are never touched: they are wherever a person saved them.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; Electron's per-user data is per user even in a per-machine install, as
    ; electron-builder's own app-data removal does it.
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endif}
    RMDir /r "$LOCALAPPDATA\Emerald\Backups"
    ; Without /r: only if it is empty.
    RMDir "$LOCALAPPDATA\Emerald"
    ${if} $installMode == "all"
      SetShellVarContext all
    ${endif}
  ${endIf}
!macroend
