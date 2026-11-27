Option Explicit
Dim shell, fso, uri, pattern, nonce, root, subDir, launcher, quote
If WScript.Arguments.Count <> 1 Then WScript.Quit 1
uri = WScript.Arguments.Item(0)
Set pattern = New RegExp
pattern.Pattern = "^vrteaching-course-ai://start/[0-9a-f]{32}$"
If Not pattern.Test(uri) Or Len(uri) <> Len("vrteaching-course-ai://start/") + 32 Then WScript.Quit 1
nonce = Right(uri, 32)
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)))
quote = Chr(34)
For Each subDir In fso.GetFolder(root).SubFolders
  launcher = fso.BuildPath(subDir.Path, "harness\launch-course.mjs")
  If fso.FileExists(launcher) Then
    shell.Run "node.exe " & quote & launcher & quote & " --developer-start " & nonce, 0, False
    WScript.Quit 0
  End If
Next
WScript.Quit 1
