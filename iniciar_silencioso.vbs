Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)

' 1. Levantar unicamente PostgreSQL en Docker y aplicar migraciones
WshShell.Run "cmd /c cd /d """ & currentDir & """ && docker compose up -d db", 0, True
WScript.Sleep 3000
WshShell.Run "cmd /c cd /d """ & currentDir & "\backend"" && npx prisma migrate deploy", 0, True

' 2. Iniciar Simulador Intranet SSO (:4300) en segundo plano
intranetCmd = "cmd /c cd /d """ & currentDir & "\simulador-intranet"" && node server.js"
WshShell.Run intranetCmd, 0, False

' 3. Iniciar Backend NestJS (:3000) en segundo plano
backendCmd = "cmd /c cd /d """ & currentDir & "\backend"" && npm run start:dev"
WshShell.Run backendCmd, 0, False

' 4. Iniciar Frontend Angular (:4200) en segundo plano
frontendCmd = "cmd /c cd /d """ & currentDir & "\frontend"" && npm start"
WshShell.Run frontendCmd, 0, False

' 5. Esperar compilacion inicial y abrir Portal Intranet SSO
WScript.Sleep 8000
WshShell.Run "http://localhost:4300", 1, False
