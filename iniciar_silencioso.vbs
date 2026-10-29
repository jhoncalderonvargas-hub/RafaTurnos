Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)

' 1. Levantar Docker Postgres en segundo plano
WshShell.Run "docker compose up -d", 0, True

' 2. Iniciar Backend (NestJS) completamente invisible
backendCmd = "cmd /c cd /d """ & currentDir & "\backend"" && npm start"
WshShell.Run backendCmd, 0, False

' 3. Iniciar Frontend (Angular) completamente invisible
frontendCmd = "cmd /c cd /d """ & currentDir & "\frontend"" && npm start"
WshShell.Run frontendCmd, 0, False

' 4. Esperar 7 segundos para que compilen y abrir el navegador
WScript.Sleep 7000
WshShell.Run "http://localhost:4200", 1, False
