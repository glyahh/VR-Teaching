Option Explicit
Dim shell, fso, handler, windowsHost, key, quote
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
quote = Chr(34)
handler = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "course-ai-protocol.vbs")
If Not fso.FileExists(handler) Then WScript.Quit 1
windowsHost = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\wscript.exe")
key = "HKCU\Software\Classes\vrteaching-course-ai\"
shell.RegWrite key, "URL:VR Teaching Course AI", "REG_SZ"
shell.RegWrite key & "URL Protocol", "", "REG_SZ"
shell.RegWrite key & "shell\open\command\", quote & windowsHost & quote & " //nologo " & quote & handler & quote & " " & quote & "%1" & quote, "REG_SZ"
If WScript.Arguments.Count = 0 Then MsgBox "VR Teaching course AI launcher registered.", vbInformation
