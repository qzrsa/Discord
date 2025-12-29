/**
 * @name Discord自动翻译
 * @author 丶曲終人散ゞ
 * @version 1.5.1
 * @description 支持硅基流动(DeepSeek)和火山方舟(豆包)双接口，实时监测并自动翻译消息；支持手动点击翻译。
 */

module.exports = class Discord自动翻译 {
    constructor() {
        this.settings = {
            provider: "siliconflow",
            apiKey: "",
            model: "deepseek-ai/DeepSeek-V3",
            autoTranslate: true,
            manualTranslate: true
        };
        this.observedMessages = new Set();
    }

    start() {
        this.loadSettings();

        this.observer = new MutationObserver(() => {
            this.scanForMessages();
        });

        const chatContent = document.querySelector("nav + div") || document.body;
        this.observer.observe(chatContent, { childList: true, subtree: true });

        this.scanInterval = setInterval(() => this.scanForMessages(), 2000);

        this.scanForMessages();
        BdApi.UI.showToast("Discord自动翻译已启动", { type: "info" });
    }

    stop() {
        if (this.observer) this.observer.disconnect();
        if (this.scanInterval) clearInterval(this.scanInterval);
        this.observedMessages.clear();
        document.querySelectorAll(".ai-translation-inline").forEach(el => el.remove());
        document.querySelectorAll(".ai-translate-btn").forEach(el => el.remove());
    }

    loadSettings() {
        const saved = BdApi.Data.load("Discord自动翻译", "settings");
        if (saved) this.settings = Object.assign(this.settings, saved);
    }

    save() {
        BdApi.Data.save("Discord自动翻译", "settings", this.settings);
        this.observedMessages.clear();
    }

    scanForMessages() {
        const messageElements = document.querySelectorAll('[id^="message-content-"]');

        messageElements.forEach((el) => {
            if (this.settings.manualTranslate) this.injectManualTranslateButton(el);

            if (!this.settings.autoTranslate) return;

            const messageId = el.id;
            if (messageId && !this.observedMessages.has(messageId)) {
                const text = el.innerText.trim();
                if (text.length > 1 && this.isNotChinese(text)) {
                    this.observedMessages.add(messageId);
                    this.doTranslateInline(text, el);
                }
            }
        });
    }

    injectManualTranslateButton(container) {
        if (!container) return;
        if (container.querySelector(".ai-translate-btn")) return;

        const btn = document.createElement("span");
        btn.className = "ai-translate-btn";
        btn.innerText = "翻译";
        btn.style.cssText = "display:inline-block;margin-left:8px;cursor:pointer;font-size:12px;opacity:.75;user-select:none;";

        btn.onmouseenter = () => btn.style.opacity = "1";
        btn.onmouseleave = () => btn.style.opacity = ".75";

        btn.onclick = async (e) => {
            e.stopPropagation();

            const text = container.innerText.trim();
            if (!text || text.length < 2) return;

            if (!this.settings.apiKey) {
                BdApi.UI.showToast("请先在设置里填写 API Key", { type: "warning" });
                return;
            }

            container.querySelectorAll(".ai-translation-inline").forEach(el => el.remove());
            await this.doTranslateInline(text, container);
        };

        container.appendChild(btn);
    }

    isNotChinese(text) {
        const chineseChars = text.match(/[\u4E00-\u9FA5]/g);
        if (!chineseChars) return true;
        return (chineseChars.length / text.length) < 0.3;
    }

    async doTranslateInline(originalText, container) {
        if (!this.settings.apiKey) return;

        const translationEl = document.createElement("div");
        translationEl.className = "ai-translation-inline";
        translationEl.style.cssText = "color:#43b581;font-size:.85em;margin-top:4px;padding:4px 8px;background:rgba(67,181,129,.05);border-left:2px solid #43b581;border-radius:4px;";
        translationEl.innerText = "...";
        container.appendChild(translationEl);

        const apiUrl = this.settings.provider === "volcengine"
            ? "https://ark.cn-beijing.volces.com/api/v3/chat/completions"
            : "https://api.siliconflow.cn/v1/chat/completions";

        try {
            const response = await fetch(apiUrl, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${this.settings.apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: this.settings.model,
                    messages: [
                        { role: "system", content: "你是一个翻译助手，只需将内容翻译成中文，直接输出结果。" },
                        { role: "user", content: originalText }
                    ]
                })
            });

            const data = await response.json();
            if (data.choices && data.choices[0]) {
                translationEl.innerText = data.choices[0].message.content;
            } else {
                throw new Error(data.error?.message || "接口返回异常");
            }
        } catch (e) {
            translationEl.innerHTML = `<span style="color:#f04747;opacity:.7;">翻译出错: ${e.message}</span>`;
            if (String(e.message).includes("404")) translationEl.innerText = "错误: 请检查 Endpoint ID 是否正确";
        }
    }

    getSettingsPanel() {
        const panel = document.createElement("div");
        panel.style.padding = "10px";
        panel.style.color = "#111";

        panel.innerHTML = `
            <div style="margin-bottom:15px;display:flex;justify-content:space-between;align-items:center;">
                <span style="font-weight:bold;">自动翻译模式</span>
                <input type="checkbox" id="sf-auto" ${this.settings.autoTranslate ? "checked" : ""} style="width:18px;height:18px;cursor:pointer;">
            </div>

            <div style="margin-bottom:15px;display:flex;justify-content:space-between;align-items:center;">
                <span style="font-weight:bold;">手动翻译按钮</span>
                <input type="checkbox" id="sf-manual" ${this.settings.manualTranslate ? "checked" : ""} style="width:18px;height:18px;cursor:pointer;">
            </div>

            <div style="margin-bottom:15px;">
                <label style="display:block;margin-bottom:5px;">接口平台 (Provider)</label>
                <select id="sf-provider">
                    <option value="siliconflow" ${this.settings.provider === "siliconflow" ? "selected" : ""}>硅基流动 (DeepSeek)</option>
                    <option value="volcengine" ${this.settings.provider === "volcengine" ? "selected" : ""}>火山方舟 (Doubao)</option>
                </select>
            </div>

            <div style="margin-bottom:15px;">
                <label style="display:block;margin-bottom:5px;">API Key</label>
                <input type="password" id="k" value="${this.settings.apiKey}" placeholder="填入对应平台的 API Key">
            </div>

            <div>
                <label style="display:block;margin-bottom:5px;">模型名称 / Endpoint ID</label>
                <input type="text" id="m" value="${this.settings.model}" placeholder="DeepSeek-V3 或 火山接入点ID">
                <p style="font-size:11px;color:#666;margin-top:5px;">注：火山方舟请填写控制台的“推理接入点 ID”(ep-xxxxxx)。</p>
            </div>
        `;

        const setInputStyle = (el) => {
            if (!el) return;
            el.style.background = "#fff";
            el.style.color = "#111";
            el.style.border = "1px solid #bbb";
            el.style.borderRadius = "6px";
            el.style.padding = "10px";
            el.style.outline = "none";
            if (el.style.setProperty) {
                el.style.setProperty("background", "#fff", "important");
                el.style.setProperty("color", "#111", "important");
            }
        };

        const select = panel.querySelector("#sf-provider");
        const key = panel.querySelector("#k");
        const model = panel.querySelector("#m");

        setInputStyle(select);
        setInputStyle(key);
        setInputStyle(model);

        if (select) {
            Array.from(select.options || []).forEach(opt => {
                opt.style.background = "#fff";
                opt.style.color = "#111";
            });
        }

        panel.querySelector("#sf-auto").onchange = (e) => {
            this.settings.autoTranslate = e.target.checked;
            this.save();
        };

        panel.querySelector("#sf-manual").onchange = (e) => {
            this.settings.manualTranslate = e.target.checked;
            this.save();
        };

        panel.querySelector("#sf-provider").onchange = (e) => {
            this.settings.provider = e.target.value;
            this.save();
        };

        panel.querySelector("#k").onchange = (e) => {
            this.settings.apiKey = e.target.value;
            this.save();
        };

        panel.querySelector("#m").onchange = (e) => {
            this.settings.model = e.target.value;
            this.save();
        };

        return panel;
    }
};
