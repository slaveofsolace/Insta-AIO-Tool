# Rollback and removal

## Before rollback

Export the current workspace from **Settings → Export backup**. Keep the JSON
file outside the application installation directory and protect it as
sensitive: it can contain imported personal data and extension pairing
material. Revoke pairings before sharing an export.

## PWA rollback

1. Stop the local server.
2. Restore the previous application release.
3. Start the server.
4. Reload the page and allow the service worker to activate.

Application cache rollback does not delete IndexedDB. State migrations are additive, but older application versions may not understand fields introduced by a newer schema. Use an export created by the target version when strict backward compatibility is required.

## Desktop rollback

1. Close the desktop application.
2. Uninstall the current program version.
3. Install the previously approved installer.
4. Open the application and verify the workspace.
5. If needed, restore a compatible exported workspace through **Import / Export**.

Desktop uninstall retains local application data by default.

## Startup backups

The desktop shell keeps the five newest timestamped storage backups in an app-specific backup directory. Each backup contains a `backup.json` manifest and the browser-storage directories that existed at startup.

Manual restoration should be performed only while the application is closed:

1. Preserve the current data directory separately.
2. Select a backup whose application version and date are appropriate.
3. Restore its storage directories into the app-specific data directory.
4. Launch the application and verify the workspace.

Prefer the in-app JSON export/restore path when it is available; it is portable and schema-aware.

## Extension removal

1. Revoke the pairing in the PWA.
2. Revoke the matching origin in the extension popup.
3. Remove the extension through the browser extension manager.

Removing the extension does not delete PWA workspace data.

## Complete data removal

Use **Settings → Clear local workspace** before uninstalling if the goal is to remove application records through the supported UI. Browser site-data controls or operating-system application-data controls may then be used to remove any retained caches and desktop backups.
