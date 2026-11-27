Option Explicit
Dim fso, shell, here, repoRoot, subDir, courseDir, launcher, candidate
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
repoRoot = fso.GetParentFolderName(fso.GetParentFolderName(here))
courseDir = ""

On Error Resume Next
For Each subDir In fso.GetFolder(repoRoot).SubFolders
  candidate = fso.BuildPath(subDir.Path, "harness\launch-course.mjs")
  If fso.FileExists(candidate) Then
    courseDir = subDir.Path
    launcher = candidate
    Exit For
  End If
Next
If courseDir <> "" Then
  Dim rc
  rc = shell.Run("node """ & launcher & """", 0, False)
  If Err.Number <> 0 Then
    Err.Clear
    Dim file
    For Each file In fso.GetFolder(courseDir).Files
      If LCase(fso.GetExtensionName(file.Name)) = "html" Then
        shell.Run """" & file.Path & """", 1, False
        Exit For
      End If
    Next
  End If
End If
On Error GoTo 0
