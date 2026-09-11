Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

$distPath = "C:\Users\tomok\orca\workspaces\dopamap_addon\oarfish\dist"

$rootElement = [System.Windows.Automation.AutomationElement]::RootElement

Write-Host "Waiting for file dialog..."

$maxWait = 15
$waited = 0
$found = $false

while ($waited -lt $maxWait -and -not $found) {
    Start-Sleep -Milliseconds 300
    $waited += 0.3
    
    $allWindows = $rootElement.FindAll(
        [System.Windows.Automation.TreeScope]::Children,
        [System.Windows.Automation.Condition]::TrueCondition
    )
    
    foreach ($win in $allWindows) {
        $name = $win.Current.Name
        if ($name -match "選択" -or $name -match "拡張機能のディレクトリ") {
            Write-Host "Found dialog: '$name'"
            
            # Find ComboBox or Edit in the file dialog for folder path
            $editCondition = New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                [System.Windows.Automation.ControlType]::Edit
            )
            $comboCondition = New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                [System.Windows.Automation.ControlType]::ComboBox
            )
            
            $edits = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
            
            Write-Host "Edit fields: $($edits.Count)"
            foreach ($edit in $edits) {
                try {
                    $valuePattern = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                    $currentValue = $valuePattern.Current.Value
                    Write-Host "  Edit '$($edit.Current.Name)' = '$currentValue'"
                    # Try all fields
                    $valuePattern.SetValue($distPath)
                    Write-Host "  -> Set to: $distPath"
                } catch {
                    Write-Host "  -> No value pattern: $($_.Exception.Message)"
                }
            }
            
            Start-Sleep -Milliseconds 500
            
            # Click OK button (フォルダーの選択)
            $buttonCondition = New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                [System.Windows.Automation.ControlType]::Button
            )
            $buttons = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
            foreach ($btn in $buttons) {
                $btnName = $btn.Current.Name
                Write-Host "Button: '$btnName'"
                if ($btnName -match "選択" -or $btnName -match "OK" -or $btnName -match "開く") {
                    Write-Host "Clicking: $btnName"
                    $invokePattern = $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
                    $invokePattern.Invoke()
                    $found = $true
                    break
                }
            }
            break
        }
    }
}

if (-not $found) {
    Write-Host "Dialog not found within timeout"
}
