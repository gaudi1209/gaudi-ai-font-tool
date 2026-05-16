/* AI字库生字 - 前端逻辑 */

let currentTab = 0;
let pollTimer = null;
let diffGroups = null;      // 差集分组数据
let currentResultDir = '';   // 当前展示卡片的目录
let groupQueue = [];         // 待生成的组队列
let groupGenerating = false; // 是否正在逐组生成

function switchTab(idx) {
    currentTab = idx;
    document.querySelectorAll('.gen-tab').forEach((t, i) => t.classList.toggle('active', i === idx));
    document.querySelectorAll('.tab-content').forEach((t, i) => t.classList.toggle('active', i === idx));
}

document.addEventListener('DOMContentLoaded', () => {
    const textarea = document.getElementById('charInput');
    if (textarea) {
        textarea.addEventListener('input', () => {
            const chars = textarea.value.replace(/[\s\n\r]/g, '');
            // 使用 Array.from 正确处理 surrogate pair（CJK 扩展区字符）
            document.getElementById('charCount').textContent = `${Array.from(chars).length} 个字符`;
        });
    }
    const browseInput = document.getElementById('browseInput');
    if (browseInput) {
        browseInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && _browseTarget) {
                document.getElementById(_browseTarget).value = browseInput.value;
                document.getElementById('browseModal').style.display = 'none';
            }
        });
    }
    apiRequest('/api/generate/status').then(data => { if (data.status === 'generating') startPolling(); }).catch(() => {});
    restoreDiffGroups();
});

async function calcMissing() {
    const ttfPath = document.getElementById('ttfPath1').value;
    const textFile = document.getElementById('textFile1').value;
    if (!ttfPath || !textFile) { showToast('请填写TTF路径和文本文件', 'error'); return; }
    showLoading('计算缺失字符...');
    try {
        const data = await apiRequest('/api/generate/missing_chars', { method: 'POST', body: JSON.stringify({ ttf_path: ttfPath, text_file: textFile }) });
        hideLoading();
        const el = document.getElementById('missingResult1');
        el.style.display = 'block';
        if (data.missing_chars && data.missing_chars.length > 0) {
            el.innerHTML = `文本: <span class="highlight">${data.text_total}</span> 字 · 字体已有: <span class="highlight">${data.font_total}</span> 字 · 缺失: <span class="highlight">${data.missing_count}</span> 字`;
            document.getElementById('textDisplay1').value = data.missing_chars.join('');
            document.getElementById('missingCount1').textContent = `${data.missing_count} 个缺失字符`;
        } else {
            el.innerHTML = '字体已包含所有字符，无缺失';
            document.getElementById('textDisplay1').value = '';
            document.getElementById('missingCount1').textContent = '0 个缺失字符';
        }
        // 显示PUA检测结果
        showPuaResult('puaResult1', data.pua_chars, data.pua_count, data.pua_total);
    } catch (e) { hideLoading(); }
}

// 显示PUA检测结果
function showPuaResult(elementId, puaChars, puaCount, puaTotal) {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (!puaChars || puaChars.length === 0) {
        el.style.display = 'none';
        return;
    }
    el.style.display = 'block';
    const totalStr = puaTotal ? ` (${puaTotal}处)` : '';
    let html = `<div class="pua-info-title">⚠ PUA私用区字符 ${puaCount}种${totalStr}</div>`;
    html += '<div class="pua-info-list">';
    puaChars.forEach(p => {
        const mapped = p.mapped_char ? ` → <b style="font-family:'SimSun','KaiTi',serif;font-size:14px">${p.mapped_char}</b> (${p.mapped_code})` : '';
        const sysFonts = p.system_fonts && p.system_fonts.length > 0 ? `<span style="color:#8a7a6a;font-size:9px;margin-left:3px">[${p.system_fonts.join('/')}]</span>` : '';
        html += `<span title="${p.code}">${p.code} <span style="font-family:'SimSun','KaiTi','Microsoft YaHei',serif;font-size:13px">${p.char}</span>${mapped}${sysFonts}</span>`;
    });
    html += '</div>';
    html += `<div style="margin-top:6px"><button class="btn btn-secondary" onclick="exportPuaResult('${elementId}')" style="font-size:10px;padding:2px 8px">导出列表</button></div>`;
    el.innerHTML = html;
}

// 导出PUA检测结果
function exportPuaResult(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const spans = el.querySelectorAll('.pua-info-list > span');
    const lines = Array.from(spans).map(s => {
        const code = s.getAttribute('title');
        const text = s.textContent.trim();
        return `${code}\t${text}`;
    });
    const text = `PUA字符列表 (${spans.length}种)\n\nPUA编码\t字符信息\n${'─'.repeat(40)}\n${lines.join('\n')}\n`;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `PUA字符检测_${new Date().toISOString().slice(0,10)}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast(`已导出 ${spans.length} 个PUA字符`, 'success');
}

// Tab0: 文本输入PUA检测
async function checkPuaText() {
    const text = document.getElementById('charInput').value;
    if (!text) { showToast('请先输入文本', 'error'); return; }
    try {
        const data = await apiRequest('/api/generate/pua_check', { method: 'POST', body: JSON.stringify({ text }) });
        if (data.pua_count > 0) {
            const mapped = data.pua_chars.filter(p => p.mapped_char).map(p => `${p.mapped_char}`).join('');
            const mappedStr = mapped ? `，可识别: ${mapped}` : '';
            document.getElementById('puaResult0').innerHTML = `⚠ 发现 <b>${data.pua_count}</b> 种PUA字符 (${data.pua_total}处)${mappedStr}`;
            document.getElementById('puaResult0').style.color = '#8a6a6a';
        } else {
            document.getElementById('puaResult0').innerHTML = '✓ 未检测到PUA字符';
            document.getElementById('puaResult0').style.color = '#6a8a6a';
        }
    } catch (e) {}
}

// Tab3: 失败重试PUA检测
async function checkPuaFail() {
    const text = document.getElementById('failInput').value;
    if (!text) { showToast('请先输入字符', 'error'); return; }
    try {
        const data = await apiRequest('/api/generate/pua_check', { method: 'POST', body: JSON.stringify({ text }) });
        if (data.pua_count > 0) {
            const mapped = data.pua_chars.filter(p => p.mapped_char).map(p => `${p.mapped_char}`).join('');
            const mappedStr = mapped ? `，可识别: ${mapped}` : '';
            document.getElementById('puaResult3').innerHTML = `⚠ 发现 <b>${data.pua_count}</b> 种PUA字符 (${data.pua_total}处)${mappedStr}`;
            document.getElementById('puaResult3').style.color = '#8a6a6a';
        } else {
            document.getElementById('puaResult3').innerHTML = '✓ 未检测到PUA字符';
            document.getElementById('puaResult3').style.color = '#6a8a6a';
        }
    } catch (e) {}
}

async function calcDiffGroups() {
    const ttfPath = document.getElementById('ttfPath2').value;
    const outputDir = document.getElementById('outputDir2').value;
    const charset = document.getElementById('charsetSelect').value;
    if (!ttfPath) { showToast('请填写TTF路径', 'error'); return; }
    showLoading('计算差集...');
    try {
        const data = await apiRequest('/api/generate/diff_groups', { method: 'POST', body: JSON.stringify({ ttf_path: ttfPath, charset, output_dir: outputDir }) });
        hideLoading();
        diffGroups = data;

        // 显示统计
        const el = document.getElementById('diffResult2');
        el.style.display = 'block';
        let html = `字符集 <span class="highlight">${charset}</span>: ${data.charset_size} 字<br>字体已有: <span class="highlight">${data.font_size}</span> 字<br>缺失: <span class="highlight">${data.missing_count}</span> 字<br>分组: <span class="highlight">${data.groups.length}</span> 组 (500字/组)`;
        el.innerHTML = html;

        // 渲染分组复选框队列
        const queue = document.getElementById('groupQueue2');
        const checkboxes = document.getElementById('groupCheckboxes');
        if (data.groups && data.groups.length > 0) {
            queue.style.display = 'block';
            checkboxes.innerHTML = '';
            data.groups.forEach((g, i) => {
                const label = document.createElement('label');
                label.style.cssText = 'display:flex;align-items:center;gap:4px;padding:3px 6px;font-size:12px;color:#4a4a4a;cursor:pointer;border-radius:3px';
                label.onmouseenter = () => label.style.background = '#f0ede8';
                label.onmouseleave = () => label.style.background = '';
                label.innerHTML = `<input type="checkbox" class="group-cb" data-group-index="${i}" onchange="updateGroupCount()"> 第${String(i + 1).padStart(2, '0')}组 (${g.size}字)`;
                checkboxes.appendChild(label);
            });
            document.getElementById('selectAllGroups').checked = false;
            updateGroupCount();
        } else {
            queue.style.display = 'none';
        }
    } catch (e) { hideLoading(); }
}

async function exportDiffTxt() {
    if (!diffGroups) { showToast('请先计算差集', 'error'); return; }
    const ttfPath = document.getElementById('ttfPath2').value;
    const outputDir = document.getElementById('outputDir2').value;
    const charset = document.getElementById('charsetSelect').value;
    const exportGroupSize = parseInt(document.getElementById('exportGroupSize').value) || 500;
    if (!outputDir) { showToast('请填写输出目录', 'error'); return; }
    showLoading('导出差集TXT...');
    try {
        const data = await apiRequest('/api/generate/diff_groups', { method: 'POST', body: JSON.stringify({ ttf_path: ttfPath, charset, output_dir: outputDir, export_group_size: exportGroupSize }) });
        hideLoading();
        if (data.export_file) {
            showToast(`已导出: ${data.export_file}`, 'success');
        } else {
            showToast('导出失败', 'error');
        }
    } catch (e) { hideLoading(); }
}

function toggleAllGroups(checked) {
    document.querySelectorAll('.group-cb').forEach(cb => cb.checked = checked);
    updateGroupCount();
}

function updateGroupCount() {
    const total = document.querySelectorAll('.group-cb').length;
    const checked = document.querySelectorAll('.group-cb:checked').length;
    document.getElementById('selectedGroupCount').textContent = checked > 0 ? `已选 ${checked}/${total} 组` : '';
    // 保存勾选状态
    saveGroupSelection();
}

function saveGroupSelection() {
    if (!diffGroups) return;
    const selected = [...document.querySelectorAll('.group-cb:checked')].map(cb => parseInt(cb.dataset.groupIndex));
    localStorage.setItem('gen_diffGroups', JSON.stringify(diffGroups));
    localStorage.setItem('gen_groupSelection', JSON.stringify(selected));
}

function restoreDiffGroups() {
    try {
        const saved = localStorage.getItem('gen_diffGroups');
        const savedSel = localStorage.getItem('gen_groupSelection');
        if (!saved) return;
        diffGroups = JSON.parse(saved);
        const selected = savedSel ? JSON.parse(savedSel) : [];
        // 渲染统计
        const el = document.getElementById('diffResult2');
        el.style.display = 'block';
        el.innerHTML = `字符集 <span class="highlight">${diffGroups.charset_name || ''}</span>: ${diffGroups.charset_size} 字<br>字体已有: <span class="highlight">${diffGroups.font_size}</span> 字<br>缺失: <span class="highlight">${diffGroups.missing_count}</span> 字<br>分组: <span class="highlight">${diffGroups.groups.length}</span> 组 (500字/组)`;
        // 渲染复选框并恢复勾选
        const queue = document.getElementById('groupQueue2');
        const checkboxes = document.getElementById('groupCheckboxes');
        if (diffGroups.groups && diffGroups.groups.length > 0) {
            queue.style.display = 'block';
            checkboxes.innerHTML = '';
            diffGroups.groups.forEach((g, i) => {
                const label = document.createElement('label');
                label.style.cssText = 'display:flex;align-items:center;gap:4px;padding:3px 6px;font-size:12px;color:#4a4a4a;cursor:pointer;border-radius:3px';
                label.onmouseenter = () => label.style.background = '#f0ede8';
                label.onmouseleave = () => label.style.background = '';
                const chk = selected.includes(i) ? 'checked' : '';
                label.innerHTML = `<input type="checkbox" class="group-cb" data-group-index="${i}" ${chk} onchange="updateGroupCount()"> 第${i + 1}组 (${g.size}字)`;
                checkboxes.appendChild(label);
            });
            document.getElementById('selectAllGroups').checked = selected.length === diffGroups.groups.length;
            updateGroupCount();
        }
    } catch (e) {}
}

function openTxtFile(path) {
    fetch('/api/open_dir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) })
    .catch(() => {});
}

async function startGenerate() {
    // Tab2 分组模式
    if (currentTab === 2 && diffGroups) {
        const selected = [...document.querySelectorAll('.group-cb:checked')].map(cb => parseInt(cb.dataset.groupIndex));
        if (!selected.length) { showToast('请勾选至少一组', 'error'); return; }
        const outputDir = document.getElementById('outputDir2').value;
        if (!outputDir) { showToast('请填写输出目录', 'error'); return; }
        groupQueue = selected.map(i => ({ index: i, chars: diffGroups.groups[i].chars }));
        groupGenerating = true;
        showToast(`开始逐组生成，共 ${groupQueue.length} 组`, 'success');
        document.getElementById('genLog').innerHTML = '';
        processNextGroup(outputDir);
        return;
    }

    // 其他 Tab 正常模式
    const params = collectParams();
    if (!params) return;
    try {
        const data = await apiRequest('/api/generate/start', { method: 'POST', body: JSON.stringify(params) });
        if (data.success) { showToast('生成已启动', 'success'); document.getElementById('genLog').innerHTML = ''; startPolling(); }
        else showToast(data.error || '启动失败', 'error');
    } catch (e) {}
}

async function processNextGroup(outputDir) {
    if (!groupQueue.length || !groupGenerating) {
        groupGenerating = false;
        appendLog(document.getElementById('genLog'), '所有分组生成完成');
        return;
    }
    const group = groupQueue.shift();
    const groupDir = outputDir.replace(/[\\/]+$/, '') + '/group_' + String(group.index + 1).padStart(2, '0');
    const commonParams = {
        chars: group.chars,
        output_dir: groupDir,
        checkpoint: document.getElementById('checkpoint').value,
        multiplier: parseInt(document.getElementById('multiplier').value),
        max_rounds: parseInt(document.getElementById('maxRounds').value),
        threshold: parseFloat(document.getElementById('threshold').value),
        cfg: parseFloat(document.getElementById('cfg').value),
        resolution: parseInt(document.getElementById('resolution')?.value || '256'),
        ref_size: parseInt(document.getElementById('refSize')?.value || '128'),
        batch_size: parseInt(document.getElementById('batchSize')?.value || '64'),
    };
    const refFont = document.getElementById('refFont')?.value || '';
    const extFont = document.getElementById('extFont')?.value || '';
    if (refFont) commonParams.ref_font = refFont;
    if (extFont) commonParams.ext_font = extFont;
    if (!commonParams.checkpoint) { showToast('请填写AI模型路径', 'error'); groupGenerating = false; return; }

    appendLog(document.getElementById('genLog'), `▶ 开始第 ${group.index + 1} 组 (${group.chars.length} 字)`);
    try {
        const data = await apiRequest('/api/generate/start', { method: 'POST', body: JSON.stringify(commonParams) });
        if (data.success) {
            startGroupPolling(groupDir);
        } else {
            showToast(data.error || '启动失败', 'error');
            groupGenerating = false;
        }
    } catch (e) { groupGenerating = false; }
}

function startGroupPolling(groupDir) {
    stopPolling();
    pollTimer = setInterval(async () => {
        try {
            const data = await apiRequest('/api/generate/status');
            updateDisplay(data);
            if (data.round_log) { const logEl = document.getElementById('genLog'); data.round_log.forEach(line => { if (!logEl.innerHTML.includes(line)) appendLog(logEl, line); }); }
            if (data.status === 'completed' || data.status === 'error' || data.status === 'stopped') {
                stopPolling();
                appendLog(document.getElementById('genLog'), `■ 第 ${data.total_chars} 字组完成: ${data.success_chars}/${data.total_chars}`);
                loadResultCards(groupDir);
                if (groupGenerating && groupQueue.length > 0) {
                    const outputDir = document.getElementById('outputDir2').value;
                    processNextGroup(outputDir);
                } else {
                    groupGenerating = false;
                }
            }
        } catch (e) {}
    }, 3000);
}

async function stopGenerate() {
    groupGenerating = false;
    groupQueue = [];
    try { await apiRequest('/api/generate/stop', { method: 'POST' }); showToast('正在停止...', 'info'); } catch (e) {}
}

function collectParams() {
    const checkpoint = document.getElementById('checkpoint').value;
    const multiplier = parseInt(document.getElementById('multiplier').value);
    const maxRounds = parseInt(document.getElementById('maxRounds').value);
    const threshold = parseFloat(document.getElementById('threshold').value);
    const cfg = parseFloat(document.getElementById('cfg').value);
    if (!checkpoint) { showToast('请填写AI模型路径', 'error'); return null; }
    let chars = [], outputDir = '';
    switch (currentTab) {
        case 0: chars = [...new Set([...document.getElementById('charInput').value.replace(/[\s\n\r]/g, '')])]; outputDir = document.getElementById('outputDir0').value; break;
        case 1: chars = [...new Set([...document.getElementById('textDisplay1').value.replace(/[\s\n\r]/g, '')])]; outputDir = document.getElementById('outputDir1').value; break;
        case 2: return null; // Tab2 由 startGenerate 分组模式处理
        case 3: chars = [...new Set([...document.getElementById('failInput').value.replace(/[\s\n\r]/g, '')])]; outputDir = document.getElementById('outputDir3').value; break;
    }
    if (!chars.length) { showToast('没有需要生成的字符', 'error'); return null; }
    if (!outputDir) { showToast('请填写输出目录', 'error'); return null; }
    const refFont = document.getElementById('refFont')?.value || '';
    const extFont = document.getElementById('extFont')?.value || '';
    const result = { chars, output_dir: outputDir, checkpoint, multiplier, max_rounds: maxRounds, threshold, cfg };
    if (refFont) result.ref_font = refFont;
    if (extFont) result.ext_font = extFont;
    return result;
}

function openResultDir() {
    const dirs = ['outputDir0','outputDir1','outputDir2','outputDir3'].map(id => document.getElementById(id).value);
    const dir = dirs[currentTab] || dirs.find(d => d);
    if (!dir) { showToast('请先填写输出目录', 'error'); return; }
    fetch('/api/open_dir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: dir }) })
    .then(r => r.json()).then(data => { if (!data.success) showToast(data.error || '打开失败', 'error'); })
    .catch(() => showToast('打开失败', 'error'));
}

function getOutputDir() {
    const dirs = ['outputDir0','outputDir1','outputDir2','outputDir3'].map(id => document.getElementById(id).value);
    return dirs[currentTab] || dirs.find(d => d) || '';
}

async function addSuffix() {
    const dir = currentResultDir || getOutputDir();
    if (!dir) { showToast('请先填写输出目录', 'error'); return; }
    try {
        const data = await apiRequest('/api/generate/add_suffix', { method: 'POST', body: JSON.stringify({ dir }) });
        if (data.success) {
            showToast(`已添加汉字后缀: ${data.renamed} 个文件`, 'success');
            refreshGenCardNames(true);
        }
    } catch (e) {}
}

async function removeSuffix() {
    const dir = currentResultDir || getOutputDir();
    if (!dir) { showToast('请先填写输出目录', 'error'); return; }
    try {
        const data = await apiRequest('/api/generate/remove_suffix', { method: 'POST', body: JSON.stringify({ dir }) });
        if (data.success) {
            showToast(`已去除汉字后缀: ${data.renamed} 个文件`, 'success');
            refreshGenCardNames(false);
        }
    } catch (e) {}
}

// 刷新生成页卡片文件名
function refreshGenCardNames(addMode) {
    document.querySelectorAll('.gen-card').forEach(card => {
        const nameEl = card.querySelector('.gen-card-name');
        if (!nameEl) return;
        const oldName = nameEl.textContent;
        let newName;
        if (addMode) {
            const m = oldName.match(/^(uni|u)([0-9A-Fa-f]+)$/i);
            if (!m) return;
            const code = parseInt(m.group(2), 16);
            try { newName = `${m.group(1)}${m.group(2)}_${String.fromCodePoint(code)}`; } catch { return; }
        } else {
            const m = oldName.match(/^(uni|u)([0-9A-Fa-f]+)_.+$/i);
            if (!m) return;
            newName = `${m.group(1)}${m.group(2)}`;
        }
        nameEl.textContent = newName;
        nameEl.title = newName + '.png';
    });
}

function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
        try {
            const data = await apiRequest('/api/generate/status');
            updateDisplay(data);
            if (data.round_log) { const logEl = document.getElementById('genLog'); data.round_log.forEach(line => { if (!logEl.innerHTML.includes(line)) appendLog(logEl, line); }); }
            if (data.status === 'completed' || data.status === 'error' || data.status === 'stopped') {
                stopPolling();
                loadResultCards(data.output_dir || '');
            }
        } catch (e) {}
    }, 3000);
}

function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

function updateDisplay(data) {
    document.getElementById('genProgress').textContent = data.progress.toFixed(1) + '%';
    document.getElementById('genSuccess').textContent = data.success_chars;
    document.getElementById('genTotal').textContent = data.total_chars;
    document.getElementById('genRound').textContent = `${data.current_round}/${data.max_rounds}`;
    document.getElementById('genTime').textContent = data.elapsed > 0 ? formatDuration(data.elapsed) : '-';
    document.getElementById('genProgressBar').style.width = data.progress + '%';
}

// 卡片网格显示生成结果（参考 OCR 页面）
async function loadResultCards(outputDir) {
    if (!outputDir) return;
    currentResultDir = outputDir;
    try {
        const data = await apiRequest('/api/generate/images?dir=' + encodeURIComponent(outputDir));
        const grid = document.getElementById('imageGrid');
        grid.innerHTML = '';
        if (data.images && data.images.length > 0) {
            const frag = document.createDocumentFragment();
            data.images.forEach(img => {
                const card = document.createElement('div');
                card.className = 'gen-card';
                card.dataset.path = img.url;
                const displayName = img.name.replace(/\.png$/i, '');
                card.innerHTML = `
                    <div class="gen-card-img"><img loading="lazy" src="${img.url}" alt="${img.name}"></div>
                    <div class="gen-card-name" title="${img.name}">${displayName}</div>
                `;
                // 右键删除
                card.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    // 从 img url 反推文件路径
                    const urlPath = img.url.replace('/api/image?path=', '');
                    const filePath = decodeURIComponent(urlPath);
                    if (confirm(`删除 ${img.name}？`)) {
                        apiRequest('/api/delete_file', {
                            method: 'POST',
                            body: JSON.stringify({ path: filePath })
                        }).then(d => {
                            if (d.success) { card.remove(); showToast(`已删除 ${img.name}`, 'success'); }
                            else showToast(d.error || '删除失败', 'error');
                        });
                    }
                });
                frag.appendChild(card);
            });
            grid.appendChild(frag);
        }
    } catch (e) {}
}
