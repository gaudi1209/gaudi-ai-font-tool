/* PaddleOCR识别 - 前端逻辑 */

let pollTimer = null;
let _inputDir = '';

document.addEventListener('DOMContentLoaded', () => {
    const browseInput = document.getElementById('browseInput');
    if (browseInput) {
        browseInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && _browseTarget) {
                document.getElementById(_browseTarget).value = browseInput.value;
                document.getElementById('browseModal').style.display = 'none';
            }
        });
    }
    apiRequest('/api/ocr/status').then(data => {
        updateDisplay(data);
        if (data.status === 'running') startPolling();
        if (data.status === 'completed') loadResults();
    }).catch(() => {});
});

async function startOCR() {
    const inputDir = document.getElementById('inputDir').value;
    if (!inputDir) { showToast('请填写输入目录', 'error'); return; }
    _inputDir = inputDir;
    const params = {
        input_dir: inputDir,
        file_filter: document.getElementById('fileFilter').value || '*.png',
        batch_size: parseInt(document.getElementById('batchSize').value) || 50,
        ocr_model: document.getElementById('ocrModel').value,
    };
    try {
        const data = await apiRequest('/api/ocr/start', { method: 'POST', body: JSON.stringify(params) });
        if (data.success) {
            showToast('OCR已启动', 'success');
            document.getElementById('ocrCardGrid').innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#aaa;padding:60px 0">识别中...</div>';
            startPolling();
        } else {
            showToast(data.error || '启动失败', 'error');
        }
    } catch (e) {}
}

async function stopOCR() {
    try { await apiRequest('/api/ocr/stop', { method: 'POST' }); showToast('正在停止...', 'info'); } catch (e) {}
}

function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
        try {
            const status = await apiRequest('/api/ocr/status');
            updateDisplay(status);
            if (status.status === 'completed' || status.status === 'error' || status.status === 'stopped') {
                stopPolling();
                if (status.status === 'error') showToast('OCR错误: ' + (status.error || '未知错误'), 'error');
                if (status.debug && status.debug.length) console.log('OCR debug:', status.debug);
                loadResults();
            }
        } catch (e) {}
    }, 2000);
}

function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

function updateDisplay(data) {
    document.getElementById('ocrProgress').textContent = data.progress + '%';
    document.getElementById('ocrProcessed').textContent = data.processed_files;
    document.getElementById('ocrTotal').textContent = data.total_files;
    document.getElementById('ocrProgressBar').style.width = data.progress + '%';
    if (data.elapsed > 0) document.getElementById('ocrTime').textContent = formatDuration(data.elapsed);
}

async function loadResults() {
    const threshold = parseFloat(document.getElementById('confThreshold').value) || 0.5;
    try {
        const data = await apiRequest('/api/ocr/results?limit=500');
        const grid = document.getElementById('ocrCardGrid');
        grid.innerHTML = '';

        if (data.results && data.results.length > 0) {
            let passCount = 0, failCount = 0;
            const frag = document.createDocumentFragment();

            data.results.forEach((r, i) => {
                const fname = r.path.split(/[\\/]/).pop();
                const displayName = fname.replace(/\.png$/i, '');
                const pass = r.confidence >= threshold;
                if (pass) passCount++; else failCount++;

                const imgUrl = '/api/image?path=' + encodeURIComponent(r.path);

                const card = document.createElement('div');
                card.className = 'ocr-card';
                card.dataset.path = r.path;
                card.innerHTML = `
                    <div class="card-img"><img loading="lazy" src="${imgUrl}" alt="${fname}"></div>
                    <div class="card-info">
                        <span class="card-text ${r.text ? '' : 'empty'}">${r.text || '?'}</span>
                        <span class="card-status ${pass ? 'pass' : 'fail'}">${pass ? 'PASS' : 'FAIL'} ${r.confidence.toFixed(2)}</span>
                    </div>
                    <div class="card-name" title="${fname}">${displayName}</div>
                `;
                // 右键删除 - 用 card.dataset.path 获取最新路径
                card.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    const currentPath = card.dataset.path;
                    const currentName = currentPath.split(/[\\/]/).pop();
                    if (confirm(`删除 ${currentName}？`)) {
                        apiRequest('/api/delete_file', {
                            method: 'POST',
                            body: JSON.stringify({ path: currentPath })
                        }).then(d => {
                            if (d.success) {
                                card.remove();
                                showToast(`已删除 ${currentName}`, 'success');
                                updateCardStats();
                            } else {
                                showToast(d.error || '删除失败', 'error');
                            }
                        });
                    }
                });
                frag.appendChild(card);
            });

            grid.appendChild(frag);

            // 更新顶部统计
            document.getElementById('ocrPass').textContent = passCount;
            document.getElementById('ocrFail').textContent = failCount;

            // 底部汇总
            document.getElementById('ocrSummary').style.display = 'flex';
            document.getElementById('sumTotal').textContent = data.results.length;
            document.getElementById('sumPass').textContent = passCount;
            document.getElementById('sumFail').textContent = failCount;
            const avgConf = data.results.reduce((s, r) => s + r.confidence, 0) / data.results.length;
            document.getElementById('sumAvgConf').textContent = avgConf.toFixed(4);
        } else {
            grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#999;padding:40px">识别完成，无结果</div>';
        }
    } catch (e) {
        document.getElementById('ocrCardGrid').innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#a06060;padding:40px">加载结果失败</div>';
    }
}

async function exportResults() {
    try {
        const data = await apiRequest('/api/ocr/results?limit=10000');
        if (!data.results || !data.results.length) { showToast('没有结果可导出', 'error'); return; }
        const threshold = parseFloat(document.getElementById('confThreshold').value) || 0.5;
        let csv = '\uFEFF文件名,识别文字,置信度,是否通过\n';
        data.results.forEach(r => {
            const fname = r.path.split(/[\\/]/).pop();
            const pass = r.confidence >= threshold;
            csv += `${fname},${r.text},${r.confidence},${pass ? '是' : '否'}\n`;
        });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'ocr_results.csv'; a.click();
        URL.revokeObjectURL(url);
        showToast('导出成功', 'success');
    } catch (e) {}
}

async function addSuffix() {
    const dir = document.getElementById('inputDir').value;
    if (!dir) { showToast('请先填写输入目录', 'error'); return; }
    try {
        const data = await apiRequest('/api/generate/add_suffix', { method: 'POST', body: JSON.stringify({ dir }) });
        if (data.success) {
            showToast(`已添加汉字后缀: ${data.renamed} 个文件`, 'success');
            refreshCardFilenames(true);
        }
    } catch (e) {}
}

async function removeSuffix() {
    const dir = document.getElementById('inputDir').value;
    if (!dir) { showToast('请先填写输入目录', 'error'); return; }
    try {
        const data = await apiRequest('/api/generate/remove_suffix', { method: 'POST', body: JSON.stringify({ dir }) });
        if (data.success) {
            showToast(`已去除汉字后缀: ${data.renamed} 个文件`, 'success');
            refreshCardFilenames(false);
        }
    } catch (e) {}
}

// 更新所有卡片的文件名显示和图片路径
function refreshCardFilenames(addMode) {
    const cards = document.querySelectorAll('.ocr-card');
    cards.forEach(card => {
        const oldPath = card.dataset.path;
        if (!oldPath) return;
        const dir = oldPath.substring(0, oldPath.lastIndexOf(/[\\/]/.test(oldPath) ? oldPath.match(/[\\/]/g).pop() : '/') + 1);
        const sep = oldPath.lastIndexOf('\\') > oldPath.lastIndexOf('/') ? '\\' : '/';
        const dirPart = oldPath.substring(0, oldPath.lastIndexOf(sep) + 1);
        const fname = oldPath.substring(oldPath.lastIndexOf(sep) + 1);

        let newFname;
        if (addMode) {
            // uni4E00.png → uni4E00_一.png
            const m = fname.match(/^(uni|u)([0-9A-Fa-f]+)\.png$/i);
            if (!m) return;
            const code = parseInt(m.group(2), 16);
            try {
                const char = String.fromCodePoint(code);
                newFname = `${m.group(1)}${m.group(2)}_${char}.png`;
            } catch { return; }
        } else {
            // uni4E00_一.png → uni4E00.png
            const m = fname.match(/^(uni|u)([0-9A-Fa-f]+)_.+\.png$/i);
            if (!m) return;
            newFname = `${m.group(1)}${m.group(2)}.png`;
        }

        const newPath = dirPart + newFname;
        card.dataset.path = newPath;
        const img = card.querySelector('.card-img img');
        if (img) img.src = '/api/image?path=' + encodeURIComponent(newPath);
        const nameEl = card.querySelector('.card-name');
        if (nameEl) {
            nameEl.textContent = newFname.replace(/\.png$/i, '');
            nameEl.title = newFname;
        }
    });
}

// 根据当前卡片重新统计
function updateCardStats() {
    const threshold = parseFloat(document.getElementById('confThreshold').value) || 0.5;
    const cards = document.querySelectorAll('.ocr-card');
    let total = 0, passCount = 0, failCount = 0, confSum = 0;
    cards.forEach(card => {
        const statusEl = card.querySelector('.card-status');
        if (!statusEl) return;
        total++;
        const isPass = statusEl.classList.contains('pass');
        if (isPass) passCount++; else failCount++;
        const confText = statusEl.textContent.match(/[\d.]+$/);
        if (confText) confSum += parseFloat(confText[0]);
    });
    // 顶部统计
    const processed = parseInt(document.getElementById('ocrProcessed').textContent) || 0;
    const newProcessed = processed - (parseInt(document.getElementById('ocrTotal').textContent) > 0 ? 1 : 0);
    document.getElementById('ocrPass').textContent = passCount;
    document.getElementById('ocrFail').textContent = failCount;
    // 底部汇总
    const summary = document.getElementById('ocrSummary');
    if (total > 0) {
        summary.style.display = 'flex';
        document.getElementById('sumTotal').textContent = total;
        document.getElementById('sumPass').textContent = passCount;
        document.getElementById('sumFail').textContent = failCount;
        document.getElementById('sumAvgConf').textContent = (confSum / total).toFixed(4);
    } else {
        summary.style.display = 'none';
    }
}
