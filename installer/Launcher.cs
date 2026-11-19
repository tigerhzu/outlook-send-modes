using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;

internal static class Program
{
    internal static readonly string Root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    internal static readonly string Data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SendModes");
    internal static int Run(string action)
    {
        var start = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"));
        start.Arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + Path.Combine(Root, "service.ps1") + "\" -Action " + action;
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        start.WindowStyle = ProcessWindowStyle.Hidden;
        // Explorer, npm and PowerShell 7 can supply different module search paths.
        start.EnvironmentVariables["PSModulePath"] = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\Modules");
        // Service errors are written to setup-error.txt. Do not capture pipes:
        // a long-lived descendant can inherit a pipe and keep ReadToEnd pending.
        using (var process = Process.Start(start))
        {
            if (!process.WaitForExit(action == "Install" ? 120000 : 60000))
            {
                // Kill only this invocation, never a port owner or process tree.
                try { process.Kill(); } catch (InvalidOperationException) { }
                Directory.CreateDirectory(Data);
                File.WriteAllText(Path.Combine(Data, "setup-error.txt"), "啟動逾時。請確認是否有尚未回覆的 localhost 憑證視窗，再重新執行安裝程式。");
                return 124;
            }
            return process.ExitCode;
        }
    }
    [STAThread]
    static int Main(string[] args)
    {
        try
        {
            if (args.Length > 0)
            {
                switch (args[0])
                {
                    case "--background":
                        for (int attempt = 0; attempt < 3; attempt++)
                        {
                            if (Run("Start") == 0) return 0;
                            if (attempt < 2) System.Threading.Thread.Sleep(5000);
                        }
                        return 1;
                    case "--install": return Run("Install");
                    case "--stop": return Run("Stop");
                    case "--remove": return Run("Remove");
                    case "--status": return Run("Status");
                    default: return 2;
                }
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupWindow());
            return 0;
        }
        catch (Exception ex)
        {
            if (args.Length == 0) MessageBox.Show(ex.Message, "寄信模式", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}

internal sealed class SetupWindow : Form
{
    readonly Label status = new Label();
    readonly TextBox detail = new TextBox();
    readonly Button test = new Button();
    public SetupWindow()
    {
        Text = "寄信模式";
        Font = new Font("Microsoft JhengHei UI", 10);
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(480, 230);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        var title = new Label { Text = "寄信模式 1.6.2", Font = new Font(Font.FontFamily, 18, FontStyle.Bold), Location = new Point(24, 20), Size = new Size(432, 40) };
        status.SetBounds(24, 72, 432, 28);
        detail.SetBounds(24, 106, 432, 52);
        detail.Multiline = true;
        detail.ReadOnly = true;
        detail.BorderStyle = BorderStyle.None;
        detail.BackColor = BackColor;
        detail.ScrollBars = ScrollBars.Vertical;
        test.Text = "診斷／測試本機";
        test.SetBounds(24, 172, 208, 38);
        test.Click += async delegate { await RefreshService(); };
        var close = new Button { Text = "關閉", Location = new Point(248, 172), Size = new Size(208, 38), DialogResult = DialogResult.Cancel };
        close.Click += delegate { Close(); };
        AcceptButton = test;
        CancelButton = close;
        Controls.AddRange(new Control[] { title, status, detail, test, close });
        Shown += async delegate { await RefreshService(); };
    }
    async Task RefreshService()
    {
        test.Enabled = false;
        status.Text = "正在測試本機…";
        status.ForeColor = SystemColors.ControlText;
        detail.Text = "";
        int result;
        try { result = await Task.Run(() => Program.Run("Status")); }
        catch (Exception ex) {
            if (IsDisposed) return;
            status.Text = "● 測試未通過"; status.ForeColor = Color.Firebrick;
            detail.Text = ex.Message; test.Enabled = true; return;
        }
        if (IsDisposed) return;
        status.Text = result == 0 ? "● 本機服務正常，可以關閉視窗" : "● 測試未通過";
        status.ForeColor = result == 0 ? Color.DarkGreen : Color.Firebrick;
        if (result == 0) detail.Text = "";
        else {
            detail.Text = "請重新執行安裝程式，再測試一次。";
            string error = Path.Combine(Program.Data, "setup-error.txt");
            try { if (File.Exists(error)) detail.Text += "\r\n" + File.ReadAllText(error); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
        test.Enabled = true;
    }
}
