# 测试文件

供音色库（设置 → 音色库）本机自测用的 PCM WAV。

## 生成样例

```powershell
npm run testdata
```

会写出：

| 文件 | 说明 |
|------|------|
| `sample-01-1s.wav` … `sample-04-4s.wav` | 正常长度，可上传并参与重建 |
| `sample-05-quiet.wav` | 音量偏小，评分偏低 |
| `sample-too-short.wav` | 约 0.25s，上传应被拒绝 |

这些是合成音，只测上传 / 解码 / 拼接管线；真克隆请换成清晰人声 WAV。

## 自测建议

1. 先传 `sample-01`～`04`，点重建，应得到约数秒 `prompt`
2. 再试 `sample-too-short.wav`，应报错「太短」
3. 有 CosyVoice 时再点试听（合成音克隆效果会很差，属预期）

大文件默认不进 Git（见根目录 `.gitignore`）。
