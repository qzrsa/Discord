/**
 * @name Discord自动翻译
 * @author 丶曲終人散ゞ
 * @version 1.6.0
 * @description  支持硅基流动和火山方舟，实时监测并自动翻译消息，支持手动点击翻译。
 */

module.exports = class Discord自动翻译 {
    constructor() {
        this.settings = {
            provider: "siliconflow",
            apiKey: "",
            model: "deepseek-ai/DeepSeek-V3.2",
            autoTranslate: true,
            manualTranslate: true
        };
        
        this.translateQueue = [];
        this.activeRequests = 0;
        this.maxConcurrent = 5; 
        this.translationCache = new Map(); 
    }

    start() {
        this.loadSettings();
        this.smartScan = this.throttle(() => this.scanForMessages(), 150);

        this.observer = new MutationObserver(() => {
            this.smartScan();
        });

        const appMount = document.getElementById("app-mount") || document.body;
        this.observer.observe(appMount, { childList: true, subtree: true });

        this.smartScan();
        BdApi.UI.showToast("Discord自动翻译 1.6.0 已启动", { type: "info" });
    }

    stop() {
        if (this.observer) this.observer.disconnect();
        this.translateQueue = [];
        this.activeRequests = 0;
        document.querySelectorAll(".ai-translation-inline").forEach(el => el.remove());
        document.querySelectorAll(".ai-translate-btn").forEach(el => el.remove());
    }

    throttle(func, wait) {
        let timeout = null;
        let lastRun = 0;
        return (...args) => {
            const now = Date.now();
            if (now - lastRun >= wait) {
                func.apply(this, args);
                lastRun = now;
            } else {
                clearTimeout(timeout);
                timeout = setTimeout(() => {
                    func.apply(this, args);
                    lastRun = Date.now();
                }, wait - (now - lastRun));
            }
        };
    }

    loadSettings() {
        const saved = BdApi.Data.load("Discord自动翻译", "settings");
        if (saved) this.settings = Object.assign(this.settings, saved);
    }

    save() {
        BdApi.Data.save("Discord自动翻译", "settings", this.settings);
        document.querySelectorAll('[data-ai-scanned-text]').forEach(el => {
            delete el.dataset.aiScannedText;
        });
        this.scanForMessages();
    }

    getCleanText(container) {
        if (!container.querySelector('.ai-translate-btn') && !container.querySelector('.ai-translation-inline')) {
            return container.textContent.trim();
        }
        const clone = container.cloneNode(true);
        clone.querySelectorAll('.ai-translate-btn, .ai-translation-inline').forEach(n => n.remove());
        return clone.textContent.trim();
    }

    insertPlaceholder(container, text) {
        let el = container.querySelector(".ai-translation-inline");
        if (!el) {
            el = document.createElement("div");
            el.className = "ai-translation-inline";
            el.style.cssText = "color:#43b581;font-size:.85em;margin-top:4px;padding:4px 8px;background:rgba(67,181,129,.05);border-left:2px solid #43b581;border-radius:4px;";
            container.appendChild(el);
        }
        el.innerHTML = text; 
        return el;
    }

    scanForMessages() {
        if (this.translationCache.size > 2000) {
            const keysToDelete = Array.from(this.translationCache.keys()).slice(0, 500);
            keysToDelete.forEach(k => this.translationCache.delete(k));
        }

        const messageElements = Array.from(document.querySelectorAll('[id^="message-content-"]')).reverse();
        const newTasks = [];

        messageElements.forEach((el) => {
            const cleanText = this.getCleanText(el);
            if (!cleanText) return; 

            if (this.settings.manualTranslate) {
                this.injectManualTranslateButton(el);
            }

            if (el.dataset.aiScannedText === cleanText) return;
            
            if (!this.settings.autoTranslate) return;

            if (cleanText.length > 1 && this.isNotChinese(cleanText)) {
                const cacheKey = el.id + "|" + cleanText;
                const cachedData = this.translationCache.get(cacheKey);

                el.querySelectorAll('.ai-translation-inline').forEach(n => n.remove());
                el.dataset.aiScannedText = cleanText; 

                if (cachedData) {
                    if (cachedData.status === 'done') {
                        this.insertPlaceholder(el, cachedData.text);
                    } else if (cachedData.status === 'translating') {
                        this.insertPlaceholder(el, cachedData.text || "翻译中...");
                    } else if (cachedData.status === 'error') {
                        this.insertPlaceholder(el, cachedData.text);
                    }
                } else {
                    this.translationCache.set(cacheKey, { status: 'pending', text: '' });
                    this.insertPlaceholder(el, "排队准备翻译中...");
                    newTasks.push({ cacheKey, messageId: el.id, originalText: cleanText });
                }
            } else {
                el.dataset.aiScannedText = cleanText;
            }
        });

        if (newTasks.length > 0) {
            this.translateQueue = [...newTasks, ...this.translateQueue];
            this.processQueue();
        }
    }

    processQueue() {
        while (this.translateQueue.length > 0 && this.activeRequests < this.maxConcurrent) {
            const task = this.translateQueue.shift();
            this.activeRequests++;
            
            this.doTranslateInline(task).finally(() => {
                this.activeRequests--;
                this.processQueue();
            });
        }
    }

    injectManualTranslateButton(container) {
        if (!container) return;
        if (container.querySelector(".ai-translate-btn")) return;

        const btn = document.createElement("span");
        btn.className = "ai-translate-btn";
        btn.innerText = "翻译";
        btn.style.cssText = "display:inline-flex;align-items:center;justify-content:center;margin-left:8px;padding:2px 8px;border-radius:6px;background:rgba(88,101,242,.18);border:1px solid rgba(88,101,242,.45);color:#5865f2;font-weight:700;font-size:12px;line-height:18px;cursor:pointer;user-select:none;";

        btn.onmouseenter = () => btn.style.background = "rgba(88,101,242,.28)";
        btn.onmouseleave = () => btn.style.background = "rgba(88,101,242,.18)";
        btn.onmousedown = () => btn.style.transform = "scale(0.98)";
        btn.onmouseup = () => btn.style.transform = "scale(1)";

        btn.onclick = (e) => {
            e.stopPropagation();

            const text = this.getCleanText(container);
            if (!text || text.length < 2) return;

            if (!this.settings.apiKey) {
                BdApi.UI.showToast("请先在设置里填写 API Key", { type: "warning" });
                return;
            }

            const cacheKey = container.id + "|" + text;
            this.translationCache.set(cacheKey, { status: 'pending', text: '' });
            container.dataset.aiScannedText = text;

            container.querySelectorAll(".ai-translation-inline").forEach(el => el.remove());
            this.doTranslateInline({ cacheKey, messageId: container.id, originalText: text });
        };

        container.appendChild(btn);
    }

    isNotChinese(text) {
        let cleanText = text.replace(/https?:\/\/[^\s]+/g, '').trim();
        if (cleanText.length === 0) return false;

        const chineseChars = cleanText.match(/[\u4E00-\u9FA5]/g);
        if (!chineseChars) return true; 
        return (chineseChars.length / cleanText.length) < 0.3;
    }

    getScroller(el) {
        let current = el.parentElement;
        while (current && current !== document.body) {
            const style = window.getComputedStyle(current);
            if (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'overlay') {
                return current;
            }
            current = current.parentElement;
        }
        return document.querySelector('[data-list-id="chat-messages"]') || el.closest('[class*="scroller-"]');
    }

    maintainScroll(scroller, container, action) {
        if (!scroller) {
            action();
            return;
        }
        const isAtBottom = Math.abs(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight) < 500;
        const oldScrollTop = scroller.scrollTop;
        const oldScrollHeight = scroller.scrollHeight;

        action();

        const heightDiff = scroller.scrollHeight - oldScrollHeight;

        if (isAtBottom) {
            scroller.scrollTop = scroller.scrollHeight;
        } else if (heightDiff > 0) {
            const containerRect = container.getBoundingClientRect();
            const scrollerRect = scroller.getBoundingClientRect();
            if (containerRect.top < scrollerRect.top) {
                scroller.scrollTop = oldScrollTop + heightDiff;
            }
        }
    }

    async doTranslateInline(task) {
        const { cacheKey, messageId, originalText } = task;
        if (!this.settings.apiKey) return;

        const cachedData = this.translationCache.get(cacheKey);
        if (!cachedData) return; 

        cachedData.status = 'translating';

        let currentContainer = document.getElementById(messageId);
        if (currentContainer && currentContainer.dataset.aiScannedText === originalText) {
            this.insertPlaceholder(currentContainer, "正在请求大模型...");
        }

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
                        { role: "system", content: "你是一个翻译助手，只需将内容翻译成中文，直接输出结果，不要输出任何额外的解释。" },
                        { role: "user", content: originalText }
                    ],
                    stream: true
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errText.slice(0, 50)}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let isFirstChunk = true;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.trim() === '') continue;
                    if (line.trim() === 'data: [DONE]') continue;
                    
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.choices && data.choices[0].delta && data.choices[0].delta.content) {
                                if (isFirstChunk) {
                                    cachedData.text = ""; 
                                    isFirstChunk = false;
                                }
                                cachedData.text += data.choices[0].delta.content;

                                const activeContainer = document.getElementById(messageId);
                                if (activeContainer && activeContainer.dataset.aiScannedText === originalText) {
                                    const scroller = this.getScroller(activeContainer);
                                    this.maintainScroll(scroller, activeContainer, () => {
                                        let el = activeContainer.querySelector(".ai-translation-inline");
                                        if (!el) el = this.insertPlaceholder(activeContainer, "");
                                        el.innerText = cachedData.text;
                                    });
                                }
                            }
                        } catch (err) {}
                    }
                }
            }
            cachedData.status = 'done';
        } catch (e) {
            cachedData.status = 'error';
            cachedData.text = `<span style="color:#f04747;opacity:.7;">翻译出错: ${e.message}</span>`;
            
            const activeContainer = document.getElementById(messageId);
            if (activeContainer && activeContainer.dataset.aiScannedText === originalText) {
                const scroller = this.getScroller(activeContainer);
                this.maintainScroll(scroller, activeContainer, () => {
                    let el = activeContainer.querySelector(".ai-translation-inline");
                    if (!el) el = this.insertPlaceholder(activeContainer, "");
                    el.innerHTML = cachedData.text;
                });
            }
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
