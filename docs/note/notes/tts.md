# 《春夏秋冬代行者》花叶雏菊 TTS 语音合成探索

利用 TTS 合成花叶雏菊音色的音频，主要复刻花叶雏菊的口吃萌点

## 花叶雏菊声音特点

- 声线偏轻、偏软，整体音量不宜太强，听感接近小声但认真地说话。
- 语速偏慢，句子之间需要留出明显停顿，避免连续长句。
- 口吃是核心特征。
- 语气胆怯、温柔、带一点不确定感，但不是夸张卖萌；重点是“想认真传达却有些紧张”。
- 句尾不要过度上扬，整体保持柔和、收束、略带犹豫的感觉。
- 文本应尽量使用短句，停顿优先放在逗号、句号和口吃之后。

## Minimax 标记语法

For texts over 3,000 characters, streaming output is recommended.
Paragraph breaks should be marked with newline characters.
Pause control: You can customize speech pauses by adding markers in the form <#x#>, where x is the pause duration in seconds. Valid range: [0.01, 99.99], up to two decimal places. Pause markers must be placed between speakable text segments and cannot be used consecutively.
Inline pronunciation: Wrap Mandarin Pinyin (with tone number 1–5) or IPA symbols or Cantonese Jyutping (with tone number 1–6) in half-width parentheses to override pronunciation of the target word or polyphonic character.
"The word live is pronounced (lɪv) as a verb and (laɪv) as an adjective."
"This is (he2)平, not (huo4)面."
"去街市買啲(sung3)。"
Interjection tags: Only supported when using speech-2.8-hd or speech-2.8-turbo models. Supported interjections: (laughs), (chuckle), (coughs), (clear-throat), (groans), (breath), (pant), (inhale), (exhale), (gasps), (sniffs), (sighs), (snorts), (burps), (lip-smacking), (humming), (hissing), (emm), (sneezes).

### 示例文本

えっと、<#0.22#>わたし、<#0.18#>ちゃんと伝えたいです。<#0.28#>ゆっくりでも、<#0.18#>きっと届きますよね。

えっと、<#0.22#>今日は少しだけ、<#0.18#>あなたに話したいことがあります。<#0.30#>上手に言えないかもしれません。<#0.22#>でも、<#0.16#>この気持ちは、<#0.18#>ちゃんと届けたいです。
