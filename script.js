        // --- 0. API Configuration ---
        // 백그라운드 프리페치 활성화 (홈 화면 로드 후 유휴 시간에 다른 메뉴 사전 캐싱)
        const ENABLE_BACKGROUND_PREFETCH = true;

        // Gemini AI Backend 중계 호출 함수 (API 키는 GAS 백엔드에서 안전하게 보관 및 관리)
        async function callGeminiAI(systemInstruction, userPrompt) {
            const res = await callApi('callGeminiApiBackend', systemInstruction, userPrompt);
            if (res && res.error) {
                const msg = res.message || '';
                if (msg.includes('503') || msg.includes('high demand') || msg.includes('UNAVAILABLE')) {
                    throw new Error('현재 Google Gemini AI 서버가 일시적인 과부하 상태입니다. 잠시 후 다시 시도해 주세요.');
                }
                if (msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
                    throw new Error('AI 요청 허용량이 일시적으로 초과되었습니다. 잠시 후 다시 시도해 주세요.');
                }
                throw new Error(msg || 'AI 분석 응답에 실패했습니다.');
            }
            return res?.text || '';
        }

        async function callApi(action, ...args) {
            if (API_URL === 'INSERT_YOUR_GAS_WEB_APP_URL_HERE') {
                alert('API URL이 설정되지 않았습니다. backend_scripts.gs를 배포하고 URL을 설정해주세요.');
                return { error: true, message: 'API URL Not Configured' };
            }
            try {
                const response = await fetch(API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // 'text/plain' avoids CORS preflight OPTIONS in some cases with GAS
                    body: JSON.stringify({ action: action, args: args })
                });

                if (!response.ok) throw new Error('Network response was not ok');

                const data = await response.json();
                return data;
            } catch (e) {
                console.error('API Error:', e);
                return { error: true, message: e.toString() };
            }
        }

        // --- 1. State & Utilities ---
        window.onerror = function (message) { document.getElementById('error-log').style.display = 'block'; document.getElementById('error-log').innerText = '! Error: ' + message; setTimeout(() => document.getElementById('error-log').style.display = 'none', 5000); };

        var state = {
            user: null,
            currentView: 'login',
            currentMonth: '',
            months: [],
            data: {},
            homeLoaded: false,
            lapseData: { lapsed: [], arrears: [], unpaid: [] },
            lapseCurrentTab: 'lapsed', // 'lapsed' or 'arrears'
            lapseLimit: 20,
            lapseLoaded: false,
            adminTab: 'reward',
            adminSubTab: 'active',
            adminPage: 1,
            adminSearch: '',
            ncSearch: '',
            pageSize: 20,
            mobileMenuOpen: false,
            isLoading: false,
            performanceData: null, // { currentYear: [], prevYear: [], currentYearLabel: '', prevYearLabel: '' }
            performanceLoaded: false,
            perfAnalysisData: null,
            perfAnalysisLoaded: false,
            perfAnalysisYear: new Date().getFullYear().toString(),
            perfAnalysisMonth: (new Date().getMonth() + 1).toString().padStart(2, '0'),
            dashboardSelectedMember: null, // { id, name } - 지사대표/운영진이 조회 중인 소속원
            recruitmentSelectedMember: null, // { id, name } - 지사대표/운영진이 조회 중인 증원수당 소속원
            forecastConfigs: [],
            actualIncentives: {},
            forecastLoaded: false,
            forecastSelectedYear: new Date().getFullYear().toString(),
            forecastStartMonth: null
        };

        // 권한1~7 중 특정 권한이 있는지 확인하는 공통 헬퍼
        function hasRole(roleName) {
            if (!state.user) return false;
            const roles = [
                state.user.role,
                state.user.role2,
                state.user.role3,
                state.user.role4,
                state.user.role5,
                state.user.role6,
                state.user.role7
            ];
            return roles.map(r => String(r || '').trim()).includes(roleName);
        }

        // 권한1~7 중 하나라도 '관리자'인지 확인
        function isAdminAny() {
            return hasRole('관리자');
        }
        // 권한1~7 중 하나라도 '지사대표'인지 확인
        function isBranchRepAny() {
            return hasRole('지사대표');
        }
        // 권한1~7 중 하나라도 '운영진'인지 확인
        function isOpsAny() {
            return hasRole('운영진');
        }

        // 권한1(state.user.role)이 '지사대표' 또는 '운영진'인지 확인
        function isForecastAllowed() {
            if (!state.user) return false;
            const primaryRole = String(state.user.role || '').trim();
            return primaryRole === '지사대표' || primaryRole === '운영진';
        }

        var LOGO_TEXT = `<div class="flex items-center gap-2 select-none">
            <span class="text-2xl font-bold text-gray-800 tracking-tight">파트너스 <span class="text-primary">보드</span></span>
        </div>`;
        var LOGO_BIG = `<div class="flex flex-col items-center justify-center gap-5 text-white select-none">
            <h1 class="text-3xl font-bold tracking-widest drop-shadow-md">파트너스<span class="font-light">본부</span></h1>
        </div>`;

        function showLoading(show) { document.getElementById('loading').classList.toggle('hidden', !show); }
        function showLoginSplash(show, statusText) {
            const splash = document.getElementById('login-splash');
            if (!splash) return;
            if (statusText) {
                const textEl = document.getElementById('splash-status-text');
                if (textEl) {
                    textEl.innerHTML = `<span class="inline-block w-2 h-2 rounded-full bg-primary animate-pulse flex-shrink-0"></span> ${statusText}`;
                }
            }
            if (show) {
                splash.classList.remove('hidden');
                // Force reflow for CSS opacity transition
                void splash.offsetWidth;
                splash.classList.remove('opacity-0');
                splash.classList.add('opacity-100');
            } else {
                splash.classList.remove('opacity-100');
                splash.classList.add('opacity-0');
                setTimeout(() => {
                    splash.classList.add('hidden');
                }, 300);
            }
        }
        function formatMoney(n) { return `<span class="tabular-nums">${Number(n || 0).toLocaleString()}</span>`; }
        function formatRate(r) {
            if (r === '' || r === null || r === undefined) return '';
            const n = Number(r);
            if (!isNaN(n)) return n.toLocaleString(undefined, { style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: 1 });
            return r;
        }

        function maskPolicyNo(policyNo) {
            if (!policyNo) return '';
            const str = String(policyNo).trim();
            if (str.length < 5) return str;
            return str.substring(0, 4) + '***' + str.substring(7);
        }

        function maskContractor(name) {
            if (!name) return '';
            const str = String(name).trim();
            if (str.length < 2) return str;
            return str.substring(0, 1) + '**' + str.substring(2);
        }

        function formatBaseDate(dateStr) {
            if (!dateStr) return '';
            const cleanStr = String(dateStr).trim();
            if (cleanStr.includes('T') || cleanStr.includes('Z')) {
                const d = new Date(cleanStr);
                if (!isNaN(d.getTime())) {
                    return `${d.getMonth() + 1}월 ${d.getDate()}일`;
                }
            }
            const normalized = cleanStr.replace(/\./g, '-');
            const parts = normalized.split('-');
            if (parts.length >= 3) {
                const month = parseInt(parts[1], 10);
                const day = parseInt(parts[2], 10);
                return `${month}월 ${day}일`;
            }
            return dateStr;
        }

        // --- 2. Navigation & History ---
        window.handleFabBack = function () {
            if (state.currentView === 'home') {
                alert('현재 첫 화면(홈)입니다.');
            } else {
                history.back();
            }
        };

        function navigate(view, push = true) {
            state.currentView = view;
            if (push) history.pushState({ view: view }, '', '#/' + view);
            state.mobileMenuOpen = false;
            render();
            // Data refresh on nav if needed
            if (view !== 'login') refresh();
            if (view === 'home' && state.user) fetchPerformanceTrend();
            if (view === 'activity' && state.user) {

                if (!state.activityState) {

                    const _todayW = getISOWeekJS(new Date());

                    state.activityState = { year: String(_todayW.year), week: String(_todayW.week), statsYear: String(_todayW.year), data: null, loaded: false };

                }

                if (!state.activityState.loaded) loadActivityData();

            }
            window.scrollTo(0, 0);
        }

        window.onpopstate = function (e) {
            if (e.state && e.state.view) {
                state.currentView = e.state.view;
                render();
                if (state.currentView === 'home') fetchPerformanceTrend();
                window.scrollTo(0, 0);
            } else {
                if (state.user) navigate('home', false);
                else navigate('login', false);
            }
        };

        // --- 3. Persistence & Session ---
        let sessionTimeoutTimer;
        const SESSION_DURATION = 30 * 60 * 1000; // 30 minutes

        function resetSessionTimer() {
            if (!state.user) return;
            clearTimeout(sessionTimeoutTimer);
            saveSession(); // Update timestamp
            sessionTimeoutTimer = setTimeout(() => {
                alert('30분 동안 움직임이 없어 안전을 위해 로그아웃 되었습니다.');
                logout();
            }, SESSION_DURATION);
        }

        // Add listeners to reset timer on user interaction
        ['click', 'mousemove', 'keydown', 'scroll', 'touchstart'].forEach(evt => {
            document.addEventListener(evt, resetSessionTimer, true);
        });

        function saveSession() {
            if (state.user) {
                // Use sessionStorage to clear when browser is closed
                sessionStorage.setItem('partners_session', JSON.stringify({
                    user: state.user,
                    months: state.months,
                    currentMonth: state.currentMonth,
                    timestamp: new Date().getTime()
                }));
            }
        }

        function restoreSession() {
            const s = sessionStorage.getItem('partners_session');
            if (s) {
                try {
                    const sess = JSON.parse(s);
                    // 30 minutes expiration check
                    if (new Date().getTime() - sess.timestamp < SESSION_DURATION) {
                        state.user = sess.user;
                        state.months = sess.months;
                        state.currentMonth = sess.currentMonth;
                        const hash = location.hash.replace('#/', '');
                        state.currentView = (hash && hash !== 'login') ? hash : 'home';
                        resetSessionTimer();
                        setTimeout(prefetchAllBackground, 500); // [OPTIMIZATION] Trigger background prefetching immediately
                        return true;
                    }
                } catch (e) { console.error('Restore failed', e); }
            }
            return false;
        }

        function clearSession() {
            clearTimeout(sessionTimeoutTimer);
            sessionStorage.removeItem('partners_session');
            history.pushState(null, '', ' ');
        }

        // --- 4. Main Render Logic ---
        window.render = function () {
            const app = document.getElementById('content');
            app.innerHTML = '';

            if (!state.user) {
                app.appendChild(createLoginView());
            } else {
                app.appendChild(createLayout());
            }
        }

        // --- 5. Views ---

        function getSkeletonUI() {
            const div = document.createElement('div');
            div.innerHTML = `
            <div class="animate-pulse flex flex-col gap-6 w-full fade-in pt-4">
                <div class="h-8 bg-gray-200 rounded-lg w-1/3 mb-2"></div>
                <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div class="h-32 bg-gray-100 rounded-2xl border border-gray-50"></div>
                    <div class="h-32 bg-gray-100 rounded-2xl border border-gray-50"></div>
                    <div class="h-32 bg-gray-100 rounded-2xl border border-gray-50 hidden md:block"></div>
                </div>
                <div class="h-64 bg-gray-100 rounded-2xl w-full mt-4 border border-gray-50"></div>
            </div>`;
            return div;
        }

        // === 당월 마감 AI 종합 브리핑 위젯 컴포넌트 ===
        async function renderAIBriefingWidget(containerEl, viewContext = 'home') {
            if (!containerEl) return;

            const isExecutive = isBranchRepAny() || isOpsAny();
            const isManager = !isExecutive && isAdminAny();
            const isSolo = !isExecutive && !isManager;

            const cacheKey = `AI_BRIEFING_${state.user.staffId}_${state.currentMonth}_${isExecutive ? 'EXEC' : (isManager ? 'MGR' : 'SOLO')}`;
            let cachedText = sessionStorage.getItem(cacheKey) || '';

            // 권한별 타이틀 및 뱃지
            let title = '';
            let badgeText = '';
            let subtitle = '';
            if (isExecutive) {
                title = '당월 마감 AI 종합 브리핑';
                badgeText = '전체 조직 총괄';
                subtitle = `Gemini AI가 ${state.currentMonth} 전체 파트너의 실적 추이와 계약 건전성 데이터를 종합 분석한 결과입니다.`;
            } else if (isManager) {
                title = `당월 마감 AI 브리핑 (${state.user.organization || '담당 소속'})`;
                badgeText = '소속 관리자';
                subtitle = `Gemini AI가 [${state.user.organization || '담당 소속'}] 소속 파트너들의 당월 실적 및 유지율 데이터를 분석한 결과입니다.`;
            } else {
                title = `${state.user.name} 님의 당월 스마트 AI 코칭 브리핑`;
                badgeText = '개인 맞춤';
                subtitle = `Gemini AI가 ${state.user.name} 님의 당월 실적, 유지율, 관리 필요 계약을 1:1 심층 분석한 결과입니다.`;
            }

            const renderCard = (contentHtml, isGenerating = false) => {
                containerEl.innerHTML = `
                <div class="bg-gradient-to-br from-indigo-50/90 via-blue-50/70 to-amber-50/60 border border-indigo-100/90 rounded-2xl shadow-sm p-4 sm:p-5 mb-6 transition-all duration-300">
                    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-3 border-b border-indigo-100/60 pb-3">
                        <div class="flex items-center gap-2.5">
                            <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-primary flex items-center justify-center text-white shadow-sm flex-shrink-0">
                                <svg class="w-4 h-4 text-amber-200 animate-pulse" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>
                            </div>
                            <div>
                                <div class="flex items-center gap-2">
                                    <h3 class="font-bold text-sm sm:text-base text-gray-800 tracking-tight flex items-center gap-1.5">
                                        ${title}
                                    </h3>
                                    <span class="px-2 py-0.5 text-[11px] font-bold rounded-full bg-indigo-100 text-indigo-700">${badgeText}</span>
                                </div>
                                <p class="text-xs text-gray-500 mt-0.5">${subtitle}</p>
                            </div>
                        </div>
                        <div class="flex items-center gap-1.5 self-end sm:self-auto">
                            ${cachedText ? `
                            <button id="ai-copy-btn" class="px-3 py-1.5 bg-white hover:bg-gray-50 border border-gray-200 text-gray-600 rounded-xl text-xs font-semibold shadow-xs transition flex items-center gap-1 cursor-pointer">
                                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                                <span>복사</span>
                            </button>` : ''}
                            <button id="ai-refresh-btn" ${isGenerating ? 'disabled' : ''} class="px-3 py-1.5 bg-white hover:bg-gray-50 border border-gray-200 text-gray-600 rounded-xl text-xs font-semibold shadow-xs transition flex items-center gap-1 cursor-pointer disabled:opacity-50">
                                <svg class="w-3.5 h-3.5 ${isGenerating ? 'animate-spin text-primary' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                                <span>${cachedText ? '다시 분석' : '분석 실행'}</span>
                            </button>
                            ${cachedText ? `
                            <button id="ai-toggle-btn" class="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-white/60 transition cursor-pointer">
                                <svg id="ai-toggle-icon" class="w-4 h-4 transform transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                            </button>` : ''}
                        </div>
                    </div>
                    <div id="ai-briefing-body">
                        ${contentHtml}
                    </div>
                </div>`;

                const refreshBtn = containerEl.querySelector('#ai-refresh-btn');
                const copyBtn = containerEl.querySelector('#ai-copy-btn');
                const toggleBtn = containerEl.querySelector('#ai-toggle-btn');
                const bodyEl = containerEl.querySelector('#ai-briefing-body');
                const toggleIcon = containerEl.querySelector('#ai-toggle-icon');

                if (refreshBtn) refreshBtn.onclick = () => generateBriefing(true);
                if (copyBtn) {
                    copyBtn.onclick = () => {
                        if (!cachedText) return;
                        navigator.clipboard.writeText(cachedText).then(() => {
                            copyBtn.innerHTML = `<svg class="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg><span class="text-emerald-600 font-bold">복사완료</span>`;
                            setTimeout(() => {
                                copyBtn.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg><span>복사</span>`;
                            }, 2000);
                        });
                    };
                }
                if (toggleBtn && bodyEl && toggleIcon) {
                    toggleBtn.onclick = () => {
                        bodyEl.classList.toggle('hidden');
                        toggleIcon.classList.toggle('rotate-180');
                    };
                }
            };

            const generateBriefing = async (force = false) => {
                if (!force && cachedText) {
                    renderCard(`<div class="whitespace-pre-wrap leading-relaxed font-medium text-slate-800 text-sm bg-white/80 p-4 rounded-xl border border-indigo-50 shadow-xs">${cachedText}</div>`);
                    return;
                }

                renderCard(`
                <div class="flex flex-col items-center justify-center py-6 text-indigo-600">
                    <div class="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-2"></div>
                    <p class="text-sm font-bold text-gray-700">Gemini AI가 실적 및 계약 건전성 데이터를 심층 분석하고 있습니다...</p>
                    <p class="text-xs text-gray-400 mt-0.5">잠시만 기다려주세요 (약 2~3초 소요)</p>
                </div>`, true);

                try {
                    let systemPrompt = "";
                    let userPrompt = "";

                    if (isExecutive) {
                        // 지사대표 & 최고 운영진: 전체 인원 및 전체 실적
                        systemPrompt = "당신은 GA(보험대리점) 파트너스본부의 최고 전략 컨설턴트입니다. 지사대표와 최고 운영진을 위한 '당월 마감 AI 종합 브리핑'을 반드시 한국어로만 작성하십시오. 영어, 사고 과정(CoT), 시스템 역할 설명 등은 일체 출력하지 마십시오. 전체 파트너들의 실적 흐름, 전반적인 계약 건전성(유지율/실효연체), 마감 전 최고 리더가 챙겨야 할 핵심 관리 전략을 한국어 개조식(Bullet points) 4~5줄로 간결하고 통찰력 있게 작성하십시오.";
                        let summaryTxt = `마감월: ${state.currentMonth}`;
                        if (state.data.adminSummary?.reward?.active) {
                            const list = state.data.adminSummary.reward.active;
                            let totalReward = 0, totalComm = 0;
                            list.forEach(x => {
                                const rPay = (x.nlPay || 0) + (x.lPay || 0) + (x.hqPay || 0) + (x.nlCorpPay || 0) + (x.lCorpPay || 0);
                                const cPay = (x.nlCommPay || 0) + (x.lCommPay || 0) + (x.mgrCommPay || 0);
                                totalReward += rPay;
                                totalComm += cPay;
                            });
                            summaryTxt += `, 위촉 파트너 수: ${list.length}명, 총지급 시상금: 약 ${Math.round(totalReward / 10000)}만원, 총지급 수수료: 약 ${Math.round(totalComm / 10000)}만원`;
                        }
                        userPrompt = `보고 대상: 파트너스본부 전체, ${summaryTxt}. 이 데이터를 바탕으로 최고 리더를 위한 당월 총평과 핵심 리스크 방어 전략 브리핑을 오직 자연스러운 한국어로만 작성해줘.`;
                    } else if (isManager) {
                        // 관리자: 본인 소속 조직의 인원 및 실적
                        const myOrg = state.user.organization || '담당 소속';
                        systemPrompt = `당신은 GA 파트너스본부의 관리자 코칭 전문가입니다. 관리자가 담당하는 [${myOrg}] 소속 파트너들을 위한 '당월 조직 AI 브리핑'을 반드시 한국어로만 작성하십시오. 영어 및 사고 과정 원문은 출력하지 마십시오. 소속 파트너들의 실적 흐름과 유지율/실효연체 관리 포인트를 한국어 개조식 3~4줄로 명확하게 작성하십시오.`;
                        let orgTxt = `담당 소속: ${myOrg}, 마감월: ${state.currentMonth}`;
                        if (state.data.adminSummary?.reward?.active) {
                            const list = state.data.adminSummary.reward.active;
                            orgTxt += `, 소속 파트너 수: ${list.length}명`;
                        }
                        userPrompt = `${orgTxt}. 이 소속 조직의 성과 향상과 계약 유지를 위한 관리자용 핵심 코칭 브리핑을 오직 한국어로만 작성해줘.`;
                    } else {
                        // 일반 파트너: 본인 1인 맞춤형
                        const myName = state.user.name;
                        const myRet = state.data.homeData?.retentionRate || '-';
                        const lapsedCnt = state.lapseData?.lapsed?.length || 0;
                        const arrearsCnt = state.lapseData?.arrears?.length || 0;
                        const unpaidCnt = state.lapseData?.unpaid?.length || 0;
                        systemPrompt = `당신은 파트너스본부의 따뜻하고 유능한 1:1 파트너 전담 AI 코치입니다. [${myName} 파트너]의 실적과 계약 상태를 분석하여, 반드시 한국어로만 친절하고 명확하게 3~4줄로 작성하십시오. 영어는 사용하지 마십시오.`;
                        userPrompt = `파트너명: ${myName}, 마감월: ${state.currentMonth}, 13회차 통산유지율: ${myRet}, 당월 실효: ${lapsedCnt}건, 당월 연체: ${arrearsCnt}건, 당월 미납: ${unpaidCnt}건. 맞춤형 코칭 브리핑을 오직 한국어로만 작성해줘.`;
                    }

                    const aiText = await callGeminiAI(systemPrompt, userPrompt);
                    cachedText = aiText || 'AI 브리핑을 생성하지 못했습니다.';
                    sessionStorage.setItem(cacheKey, cachedText);

                    // 보기 좋은 카드/단락 형태로 포맷팅 렌더링
                    const formatToPrettyHtml = (txt) => {
                        const lines = txt.split('\n').filter(l => l.trim().length > 0);
                        return lines.map(line => {
                            let trimmed = line.trim();
                            // 볼드 마크다운 파싱 (**텍스트** -> <strong>)
                            const parseInline = (s) => s.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-gray-900">$1</strong>');
                            
                            // 제목/헤더 라인 (# 또는 [대괄호] 또는 **제목**)
                            if (trimmed.startsWith('#') || (trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('**[') && trimmed.endsWith(']**'))) {
                                const cleanTitle = trimmed.replace(/^#+\s*/, '').replace(/^\*\*|\*\*$/g, '');
                                return `<h4 class="text-sm font-extrabold text-indigo-950 mt-2 mb-1 flex items-center gap-1.5"><span class="w-1.5 h-3.5 bg-indigo-600 rounded-full inline-block"></span>${cleanTitle}</h4>`;
                            }
                            if (trimmed.startsWith('*') || trimmed.startsWith('-') || /^\d+\./.test(trimmed)) {
                                const clean = trimmed.replace(/^[\*\-\d\.]+\s*/, '');
                                return `<div class="flex items-start gap-2 text-xs sm:text-sm text-slate-700 py-1 leading-relaxed"><span class="text-indigo-500 font-bold mt-0.5">•</span><span>${parseInline(clean)}</span></div>`;
                            }
                            return `<p class="text-xs sm:text-sm text-slate-700 py-1 leading-relaxed">${parseInline(trimmed)}</p>`;
                        }).join('');
                    };

                    renderCard(`<div class="leading-relaxed font-medium bg-white/90 p-4 sm:p-5 rounded-xl border border-indigo-100/80 shadow-xs space-y-1">${formatToPrettyHtml(cachedText)}</div>`);
                } catch (err) {
                    console.error(err);
                    renderCard(`<div class="p-4 bg-red-50 text-red-600 rounded-xl text-sm font-medium border border-red-100">AI 브리핑 생성 중 오류가 발생했습니다: ${err.message || err.toString()}</div>`);
                }
            };

            if (cachedText) {
                renderCard(`<div class="whitespace-pre-wrap leading-relaxed font-medium text-slate-800 text-sm bg-white/80 p-4 rounded-xl border border-indigo-50 shadow-xs">${cachedText}</div>`);
            } else {
                renderCard(`
                <div class="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white/70 p-4 rounded-xl border border-indigo-50">
                    <p class="text-sm text-gray-600 font-medium">
                        ${isExecutive ? '전체 파트너 실적과 계약 건전성을 종합 진단하는 AI 브리핑을 확인해보세요.' : (isManager ? '담당 소속 파트너들의 실적과 유지율을 분석하는 맞춤 브리핑을 확인해보세요.' : '나의 당월 실적과 유지율을 바탕으로 한 1:1 AI 코칭 리포트를 확인해보세요.')}
                    </p>
                    <button id="ai-start-btn" class="px-4 py-2 bg-gradient-to-r from-indigo-600 to-primary text-white rounded-xl text-xs font-bold shadow-sm hover:from-indigo-700 hover:to-primaryHover transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer">
                        <svg class="w-4 h-4 text-amber-200" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>
                        <span>✨ AI 브리핑 생성</span>
                    </button>
                </div>`);
                const startBtn = containerEl.querySelector('#ai-start-btn');
                if (startBtn) startBtn.onclick = () => generateBriefing(true);
            }
        }

        function createHomeView() {
            const div = document.createElement('div');

            // 보유 데이터 확인
            const hd = state.data.homeData || { retentionRate: '-', baseMonth: '-' };
            let rateClass = 'text-primary';
            let retentionDisplay = hd.retentionRate;

            if (state.homeLoaded) {
                if (hd.retentionRate !== '-' && hd.retentionRate !== '데이터 없음' && hd.retentionRate !== '') {
                    const num = parseFloat(hd.retentionRate);
                    if (!isNaN(num)) {
                        if (num >= 90) rateClass = 'text-blue-500';
                        else rateClass = 'text-red-500'; // 90% 미만 시 빨간색
                    }
                } else {
                    rateClass = 'text-gray-400 text-lg font-medium'; // 흐린 글씨, 크기 조정
                    retentionDisplay = '(해당 기간 실적 없음)';
                }
            }

            // 기존에 접속했던 사용자의 브라우저 캐시에 '2026년 1월' 형태로 남아있을 경우를 대비하여 JS에서 한번 더 포맷팅
            let displayMonth = hd.baseMonth;
            if (displayMonth && displayMonth.startsWith('20')) {
                displayMonth = displayMonth.replace(/^20(\d{2}년)/, '$1');
            }

            const formatUserType = () => {
                if (state.user.role === '지사대표') return '지사대표';
                if (state.user.role === '관리자') return '관리자';
                return state.user.organization || '파트너스';
            };

            div.innerHTML = `
                <div class="mb-6 flex items-center justify-between gap-4">
                    <div>
                        <h2 class="text-xl font-bold text-gray-800 tracking-tight">안녕하세요, ${state.user.name}님 👋</h2>
                        <p class="text-gray-500 text-sm mt-2 font-medium bg-gray-100 inline-block px-3 py-1 rounded-full">파트너스 보드에 오신 것을 환영합니다.</p>
                    </div>
                    <button onclick="handleHardRefresh()" class="flex-shrink-0 p-2.5 bg-white hover:bg-gray-50 active:bg-gray-100 border border-gray-200 rounded-xl shadow-sm text-gray-500 hover:text-primary transition-all duration-300 cursor-pointer group" title="데이터 새로고침">
                        <svg class="w-5 h-5 transition-transform duration-500 group-hover:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"></path>
                        </svg>
                    </button>
                </div>

                <!-- 당월 마감 AI 종합 브리핑 위젯 영역 -->
                <div id="home-ai-briefing-container"></div>
                
                <div class="mb-8">
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                        <!-- 1. 유지율 카드 -->
                        <div class="bg-gradient-to-br from-white to-gray-50 rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col justify-center cursor-pointer hover:border-gray-300 transition group" onclick="fetchAndShowLapsedContracts()">
                            <div class="flex items-center gap-2 mb-4 w-full">
                                <span class="w-1.5 h-4 bg-primary rounded-full inline-block"></span>
                                <p class="text-xs font-bold text-gray-700 tracking-wide">나의 13회차 통산유지율 ${displayMonth !== '-' && displayMonth !== undefined ? '(' + displayMonth + ' 기준)' : ''}</p>
                            </div>
                            <div class="text-3xl font-extrabold ${state.homeLoaded ? rateClass : 'text-primary'} tracking-tight drop-shadow-sm text-center w-full flex justify-center items-center h-10">
                                ${state.homeLoaded ? retentionDisplay : '<svg class="animate-spin w-8 h-8 text-primary/40" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>'}
                            </div>
                        </div>
                        
                        <!-- 2. 당월 실효 건수 카드 -->
                        <div class="bg-gradient-to-br from-white to-red-50/30 rounded-2xl shadow-sm border border-red-50 p-6 flex flex-col justify-center cursor-pointer hover:border-red-100 transition group" onclick="state.lapseCurrentTab='lapsed'; navigate('lapse')">
                            <div class="flex items-center gap-2 mb-4 w-full">
                                <span class="w-1.5 h-4 bg-red-400 rounded-full inline-block"></span>
                                <p id="home-lapsed-title" class="text-xs font-bold text-gray-700 tracking-wide group-hover:text-red-500 transition">당월 실효 건수${state.lapseLoaded && state.lapseData.lapsedDate ? ' <span class="text-xs font-normal text-gray-400">(' + formatBaseDate(state.lapseData.lapsedDate) + ' 기준)</span>' : ''}</p>
                            </div>
                            <div class="text-2xl font-extrabold text-red-500 tracking-tight drop-shadow-sm text-center w-full group-hover:scale-105 transition-transform duration-300 flex justify-center items-center h-8" id="home-lapsed-count">
                                ${state.lapseLoaded ? (state.lapseData.lapsed?.length || 0) + '<span class="text-lg ml-0.5 font-bold">건</span>' : '<svg class="animate-spin w-6 h-6 text-red-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>'}
                            </div>
                        </div>

                        <!-- 3. 당월 연체 건수 카드 -->
                        <div class="bg-gradient-to-br from-white to-orange-50/30 rounded-2xl shadow-sm border border-orange-50 p-6 flex flex-col justify-center cursor-pointer hover:border-orange-100 transition group" onclick="state.lapseCurrentTab='arrears'; navigate('lapse')">
                            <div class="flex items-center gap-2 mb-4 w-full">
                                <span class="w-1.5 h-4 bg-orange-400 rounded-full inline-block"></span>
                                <p id="home-arrears-title" class="text-xs font-bold text-gray-700 tracking-wide group-hover:text-orange-500 transition">당월 연체 건수${state.lapseLoaded && state.lapseData.arrearsDate ? ' <span class="text-xs font-normal text-gray-400">(' + formatBaseDate(state.lapseData.arrearsDate) + ' 기준)</span>' : ''}</p>
                            </div>
                            <div class="text-2xl font-extrabold text-orange-500 tracking-tight drop-shadow-sm text-center w-full group-hover:scale-105 transition-transform duration-300 flex justify-center items-center h-8" id="home-arrears-count">
                                ${state.lapseLoaded ? (state.lapseData.arrears?.length || 0) + '<span class="text-lg ml-0.5 font-bold">건</span>' : '<svg class="animate-spin w-6 h-6 text-orange-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>'}
                            </div>
                        </div>

                        <!-- 4. 당월 미납 건수 카드 -->
                        <div class="bg-gradient-to-br from-white to-blue-50/30 rounded-2xl shadow-sm border border-blue-50 p-6 flex flex-col justify-center cursor-pointer hover:border-blue-100 transition group" onclick="state.lapseCurrentTab='unpaid'; navigate('lapse')">
                            <div class="flex items-center gap-2 mb-4 w-full">
                                <span class="w-1.5 h-4 bg-blue-400 rounded-full inline-block"></span>
                                <p id="home-unpaid-title" class="text-xs font-bold text-gray-700 tracking-wide group-hover:text-blue-500 transition">당월 미납 건수${state.lapseLoaded && state.lapseData.unpaidDate ? ' <span class="text-xs font-normal text-gray-400">(' + formatBaseDate(state.lapseData.unpaidDate) + ' 기준)</span>' : ''}</p>
                            </div>
                            <div class="text-2xl font-extrabold text-blue-500 tracking-tight drop-shadow-sm text-center w-full group-hover:scale-105 transition-transform duration-300 flex justify-center items-center h-8" id="home-unpaid-count">
                                ${state.lapseLoaded ? (state.lapseData.unpaid?.length || 0) + '<span class="text-lg ml-0.5 font-bold">건</span>' : '<svg class="animate-spin w-6 h-6 text-blue-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>'}
                            </div>
                        </div>

                        <!-- 5. 확인서 미제출 건수 카드 -->
                        <div class="bg-gradient-to-br from-white to-indigo-50/30 rounded-2xl shadow-sm border border-indigo-50 p-6 flex flex-col justify-center cursor-pointer hover:border-indigo-100 transition group" onclick="state.lapseCurrentTab='unsubmitted'; navigate('lapse')">
                            <div class="flex items-center gap-2 mb-4 w-full">
                                <span class="w-1.5 h-4 bg-indigo-400 rounded-full inline-block"></span>
                                <p id="home-unsubmitted-title" class="text-xs font-bold text-gray-700 tracking-wide group-hover:text-indigo-500 transition">확인서 미제출 건수${state.lapseLoaded && state.lapseData.unsubmittedDate ? ' <span class="text-xs font-normal text-gray-400">(' + formatBaseDate(state.lapseData.unsubmittedDate) + ' 기준)</span>' : ''}</p>
                            </div>
                            <div class="text-2xl font-extrabold text-indigo-500 tracking-tight drop-shadow-sm text-center w-full group-hover:scale-105 transition-transform duration-300 flex justify-center items-center h-8" id="home-unsubmitted-count">
                                ${state.lapseLoaded ? (state.lapseData.unsubmitted?.length || 0) + '<span class="text-lg ml-0.5 font-bold">건</span>' : '<svg class="animate-spin w-6 h-6 text-indigo-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>'}
                            </div>
                        </div>
                    </div>
                    <div class="text-right mt-3 mb-4">
                        <p class="text-xs text-gray-500 font-medium inline-flex items-center gap-1.5 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-100">
                            <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                            Tip : 유지율 및 건수 클릭시 상세내역 확인 가능
                        </p>
                    </div>
                </div>

                <!-- 2. 실적 추이 그래프 -->
                <div class="mb-8 bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                    <div class="flex items-center justify-between mb-6">
                        <div class="flex items-center gap-2">
                            <span class="w-1.5 h-4 bg-primary rounded-full inline-block"></span>
                            <h3 class="text-sm font-bold text-gray-700 tracking-wide">나의 실적 추이 <span id="perf-closing-date" class="text-xs font-normal text-gray-400">${state.performanceLoaded && state.performanceData?.closingDate ? '(' + state.performanceData.closingDate + ' 마감 기준)' : ''}</span></h3>
                        </div>
                    </div>
                    <div class="relative h-[240px] w-full">
                        <canvas id="performanceChart"></canvas>
                        ${!state.performanceLoaded ? '<div id="perfLoader" class="absolute inset-0 flex items-center justify-center bg-white/50"><svg class="animate-spin w-8 h-8 text-primary/40" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg></div>' : ''}
                    </div>
                </div>

                <div class="mb-5 text-lg font-bold text-gray-800 border-b border-gray-100 pb-2">빠른 메뉴</div>
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    
                    <!-- 1. 계약유지관리 -->
                    ${!hasRole('실장') ? `
                    <div onclick="navigate('lapse')" class="bg-white cursor-pointer hover:-translate-y-1 hover:shadow-xl hover:border-gray-200 transition-all duration-300 rounded-2xl p-5 border border-gray-100 flex items-center text-left group gap-4">
                        <div class="w-14 h-14 bg-gray-50 text-slate-600 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-slate-700 group-hover:text-white transition-colors duration-300 shadow-sm border border-gray-100/50">
                            <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path></svg>
                        </div>
                        <div>
                            <h3 class="font-bold text-gray-800 text-base group-hover:text-primary transition-colors">계약유지관리</h3>
                            <p class="text-[11px] text-gray-400 mt-0.5">당월 실효 및 연체계약 관리</p>
                        </div>
                    </div>` : ''}

                    <!-- 2. 시상금 조회 -->
                    ${!hasRole('실장') ? `
                    <div onclick="navigate('dashboard')" class="bg-white cursor-pointer hover:-translate-y-1 hover:shadow-xl hover:border-gray-200 transition-all duration-300 rounded-2xl p-5 border border-gray-100 flex items-center text-left group gap-4">
                        <div class="w-14 h-14 bg-gray-50 text-slate-600 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-primary group-hover:text-white transition-colors duration-300 shadow-sm border border-gray-100/50">
                            <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        </div>
                        <div>
                            <h3 class="font-bold text-gray-800 text-base group-hover:text-primary transition-colors">시상금 조회</h3>
                            <p class="text-[11px] text-gray-400 mt-0.5">월별 시상금 상세 내역</p>
                        </div>
                    </div>` : ''}

                    <!-- 3. 증원수당 조회 -->
                    ${(state.user.isRecruiter && !hasRole('실장')) ? `
                    <div onclick="navigate('recruitment')" class="bg-white cursor-pointer hover:-translate-y-1 hover:shadow-xl hover:border-gray-200 transition-all duration-300 rounded-2xl p-5 border border-gray-100 flex items-center text-left group gap-4">
                        <div class="w-14 h-14 bg-gray-50 text-slate-600 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-slate-700 group-hover:text-white transition-colors duration-300 shadow-sm border border-gray-100/50">
                            <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                        </div>
                        <div>
                            <h3 class="font-bold text-gray-800 text-base group-hover:text-primary transition-colors">증원수당 조회</h3>
                            <p class="text-[11px] text-gray-400 mt-0.5">산하 인원 및 증원수당 현황</p>
                        </div>
                    </div>` : ''}




                    <!-- 4. 관리자 대시보드 -->
                    ${(isBranchRepAny() || isAdminAny()) ? `
                    <div onclick="navigate('admin')" class="bg-white cursor-pointer hover:-translate-y-1 hover:shadow-xl hover:border-gray-300 transition-all duration-300 rounded-2xl p-5 border border-gray-100 flex items-center text-left group gap-4">
                        <div class="w-14 h-14 bg-gray-50 text-slate-600 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-slate-700 group-hover:text-white transition-colors duration-300 shadow-sm border border-gray-100/50">
                            <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"></path></svg>
                        </div>
                        <div>
                            <h3 class="font-bold text-gray-800 text-base group-hover:text-primary transition-colors">관리자 대시보드</h3>
                            <p class="text-[11px] text-gray-400 mt-0.5">소속 파트너별 시상금 현황</p>
                        </div>
                    </div>` : ''}

                    <!-- 5. 지사대표 대시보드 -->
                    ${isBranchRepAny() ? `
                    <div onclick="navigate('branch')" class="bg-white cursor-pointer hover:-translate-y-1 hover:shadow-xl hover:border-gray-200 transition-all duration-300 rounded-2xl p-5 border border-gray-100 flex items-center text-left group gap-4">
                        <div class="w-14 h-14 bg-gray-50 text-slate-600 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-slate-700 group-hover:text-white transition-colors duration-300 shadow-sm border border-gray-100/50">
                            <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>
                        </div>
                        <div>
                            <h3 class="font-bold text-gray-800 text-base group-hover:text-primary transition-colors">지사대표 대시보드</h3>
                            <p class="text-[11px] text-gray-400 mt-0.5">법인 시상 및 인센티브</p>
                        </div>
                    </div>` : ''}
                    
                    <!-- 6. 계약관리(관리) -->
                    ${(isBranchRepAny() || isAdminAny() || hasRole('실장') || isOpsAny()) ? `
                    <div onclick="navigate('lapseAdmin')" class="bg-white cursor-pointer hover:-translate-y-1 hover:shadow-xl hover:border-gray-300 transition-all duration-300 rounded-2xl p-5 border border-gray-100 flex items-center text-left group gap-4">
                        <div class="w-14 h-14 bg-gray-50 text-slate-600 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-slate-700 group-hover:text-white transition-colors duration-300 shadow-sm border border-gray-100/50">
                            <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                        </div>
                        <div>
                            <h3 class="font-bold text-gray-800 text-base group-hover:text-primary transition-colors">실효연체관리</h3>
                            <p class="text-[11px] text-gray-400 mt-0.5">수금인별 실효/연체 현황</p>
                        </div>
                    </div>
                    
                    <div onclick="navigate('retentionAdmin')" class="bg-white cursor-pointer hover:-translate-y-1 hover:shadow-xl hover:border-gray-300 transition-all duration-300 rounded-2xl p-5 border border-gray-100 flex items-center text-left group gap-4">
                        <div class="w-14 h-14 bg-gray-50 text-slate-600 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-indigo-700 group-hover:text-white transition-colors duration-300 shadow-sm border border-gray-100/50">
                            <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        </div>
                        <div>
                            <h3 class="font-bold text-gray-800 text-base group-hover:text-primary transition-colors">유지율</h3>
                            <p class="text-[11px] text-gray-400 mt-0.5">통산 13회, 25회 유지율</p>
                        </div>
                    </div>` : ''}

                    <!-- 9. 채권관리 -->
                    ${isBranchRepAny() ? `
                    <div onclick="navigate('bondAdmin')" class="bg-white cursor-pointer hover:-translate-y-1 hover:shadow-xl hover:border-gray-300 transition-all duration-300 rounded-2xl p-5 border border-gray-100 flex items-center text-left group gap-4">
                        <div class="w-14 h-14 bg-gray-50 text-slate-600 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-teal-600 group-hover:text-white transition-colors duration-300 shadow-sm border border-gray-100/50">
                            <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path></svg>
                        </div>
                        <div>
                            <h3 class="font-bold text-gray-800 text-base group-hover:text-primary transition-colors">채권관리</h3>
                            <p class="text-[11px] text-gray-400 mt-0.5">지사별 채권 및 담보 부족 체크</p>
                        </div>
                    </div>` : ''}

                    <!-- 8. 실적분석 -->
                    ${(isBranchRepAny() || isOpsAny() || hasRole('실장') || hasRole('실적분석')) ? `
                    <div onclick="navigate('performanceAnalysis')" class="bg-white cursor-pointer hover:-translate-y-1 hover:shadow-xl hover:border-gray-300 transition-all duration-300 rounded-2xl p-5 border border-gray-100 flex items-center text-left group gap-4">
                        <div class="w-14 h-14 bg-gray-50 text-slate-600 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-primary group-hover:text-white transition-colors duration-300 shadow-sm border border-gray-100/50">
                            <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
                        </div>
                        <div>
                            <h3 class="font-bold text-gray-800 text-base group-hover:text-primary transition-colors">실적분석</h3>
                            <p class="text-[11px] text-gray-400 mt-0.5">데이터 기반 생보/손보 분석</p>
                        </div>
                    </div>` : ''}

                    <!-- 9. 총수당예상 -->
                    ${isForecastAllowed() ? `
                    <div onclick="navigate('totalAllowanceForecast')" class="bg-white cursor-pointer hover:-translate-y-1 hover:shadow-xl hover:border-gray-300 transition-all duration-300 rounded-2xl p-5 border border-gray-100 flex items-center text-left group gap-4">
                        <div class="w-14 h-14 bg-gray-50 text-slate-600 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-primary group-hover:text-white transition-colors duration-300 shadow-sm border border-gray-100/50">
                            <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
                        </div>
                        <div>
                            <h3 class="font-bold text-gray-800 text-base group-hover:text-primary transition-colors">총수당예상</h3>
                            <p class="text-[11px] text-gray-400 mt-0.5">월별 총 수당 예측 및 분석</p>
                        </div>
                    </div>` : ''}

                    <!-- 시상조정 빠른 카드 -->
                    ${isBranchRepAny() ? `
                    <div onclick="navigate('rewardAdjust')" class="bg-white cursor-pointer hover:-translate-y-1 hover:shadow-xl hover:border-gray-300 transition-all duration-300 rounded-2xl p-5 border border-gray-100 flex items-center text-left group gap-4">
                        <div class="w-14 h-14 bg-gray-50 text-slate-600 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-primary group-hover:text-white transition-colors duration-300 shadow-sm border border-gray-100/50">
                            <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"></path></svg>
                        </div>
                        <div>
                            <h3 class="font-bold text-gray-800 text-base group-hover:text-primary transition-colors">시상조정</h3>
                            <p class="text-[11px] text-gray-400 mt-0.5">시상 데이터 조정 및 엑셀 업로드</p>
                        </div>
                    </div>` : ''}
                </div>
            `;

            setTimeout(() => {
                const aiCont = div.querySelector('#home-ai-briefing-container');
                if (aiCont) renderAIBriefingWidget(aiCont, 'home');
            }, 10);

            return div;
        }

        function updateHomeLapseCounts() {
            if (!state.lapseLoaded) return;
            const lEl = document.getElementById('home-lapsed-count');
            const aEl = document.getElementById('home-arrears-count');
            const uEl = document.getElementById('home-unpaid-count');
            const unsEl = document.getElementById('home-unsubmitted-count');

            const lTitleEl = document.getElementById('home-lapsed-title');
            const aTitleEl = document.getElementById('home-arrears-title');
            const uTitleEl = document.getElementById('home-unpaid-title');
            const unsTitleEl = document.getElementById('home-unsubmitted-title');

            if (lEl) lEl.innerHTML = (state.lapseData.lapsed?.length || 0) + '<span class="text-lg ml-0.5 font-bold">건</span>';
            if (aEl) aEl.innerHTML = (state.lapseData.arrears?.length || 0) + '<span class="text-lg ml-0.5 font-bold">건</span>';
            if (uEl) uEl.innerHTML = (state.lapseData.unpaid?.length || 0) + '<span class="text-lg ml-0.5 font-bold">건</span>';
            if (unsEl) unsEl.innerHTML = (state.lapseData.unsubmitted?.length || 0) + '<span class="text-lg ml-0.5 font-bold">건</span>';

            if (lTitleEl && state.lapseData.lapsedDate) lTitleEl.innerHTML = `당월 실효 건수 <span class="text-xs font-normal text-gray-400">(${formatBaseDate(state.lapseData.lapsedDate)} 기준)</span>`;
            if (aTitleEl && state.lapseData.arrearsDate) aTitleEl.innerHTML = `당월 연체 건수 <span class="text-xs font-normal text-gray-400">(${formatBaseDate(state.lapseData.arrearsDate)} 기준)</span>`;
            if (uTitleEl && state.lapseData.unpaidDate) uTitleEl.innerHTML = `당월 미납 건수 <span class="text-xs font-normal text-gray-400">(${formatBaseDate(state.lapseData.unpaidDate)} 기준)</span>`;
            if (unsTitleEl && state.lapseData.unsubmittedDate) unsTitleEl.innerHTML = `확인서 미제출 건수 <span class="text-xs font-normal text-gray-400">(${formatBaseDate(state.lapseData.unsubmittedDate)} 기준)</span>`;
        }

        async function fetchPerformanceTrend() {
            if (state.performanceLoaded) {
                renderPerformanceChart();
                return;
            }
            try {
                callApiPrefetch('getPerformanceTrendData', res => {
                    if (res && res.success) {
                        state.performanceData = res;
                        state.performanceLoaded = true;
                        // 기준일 표시 업데이트
                        const dateEl = document.getElementById('perf-closing-date');
                        if (dateEl && res.closingDate) {
                            dateEl.innerText = `(${res.closingDate} 마감 기준)`;
                        }
                        renderPerformanceChart();
                    } else {
                        console.warn('실적 추이 로드 실패:', res?.message);
                        state.performanceLoaded = true; // 에러 시에도 로딩 표시 숨김
                        render(); // 로딩 표시 제거를 위해 리렌더링
                    }
                }, state.user.staffId);
            } catch (err) {
                console.error('실적 추이 API 오류:', err);
                state.performanceLoaded = true;
                render();
            }
        }

        let perfChartInstance = null;
        function renderPerformanceChart() {
            const ctx = document.getElementById('performanceChart');
            if (!ctx) return;

            // 로더 제거
            const loader = document.getElementById('perfLoader');
            if (loader) loader.remove();

            if (perfChartInstance) {
                perfChartInstance.destroy();
            }

            const data = state.performanceData;
            if (!data) return;

            const labels = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

            // 현재 1등 데이터셋 생성
            const topPerfData = new Array(12).fill(null);
            if (data.latestMonthIndex !== -1 && data.topPerformance > 0) {
                topPerfData[data.latestMonthIndex] = data.topPerformance;
            }

            perfChartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: '현재 1등',
                            data: topPerfData,
                            pointStyle: 'star',
                            pointRadius: 10,
                            pointHoverRadius: 12,
                            pointBackgroundColor: '#FFD700', // Gold
                            pointBorderColor: '#FFD700',
                            showLine: false, // 선은 그리지 않음
                            zIndex: 3
                        },
                        {
                            label: data.currentYearLabel,
                            data: data.currentYear,
                            borderColor: '#F37321', // Primary Orange
                            backgroundColor: 'rgba(243, 115, 33, 0.1)',
                            borderWidth: 3,
                            fill: true,
                            tension: 0.4,
                            pointRadius: 4,
                            pointBackgroundColor: '#F37321',
                            spanGaps: false, // null을 만나면 선을 끊음
                            zIndex: 2
                        },
                        {
                            label: data.prevYearLabel,
                            data: data.prevYear,
                            borderColor: '#cbd5e1', // Light gray
                            backgroundColor: 'transparent',
                            borderWidth: 2,
                            borderDash: [5, 5],
                            fill: false,
                            tension: 0.4,
                            pointRadius: 0,
                            zIndex: 1
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        mode: 'index',
                        intersect: false
                    },
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top',
                            align: 'end',
                            labels: {
                                boxWidth: 8,
                                boxHeight: 8,
                                font: {
                                    size: 11,
                                    weight: 'bold'
                                },
                                usePointStyle: true,
                                padding: 20
                            }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(0, 0, 0, 0.8)',
                            padding: 12,
                            titleFont: { size: 13, weight: 'bold' },
                            bodyFont: { size: 12 },
                            cornerRadius: 8,
                            usePointStyle: true,
                            callbacks: {
                                label: function (context) {
                                    const val = context.parsed.y;
                                    const rounded = Math.round(val);
                                    return context.dataset.label + ': ' + rounded.toLocaleString() + '만원';
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: {
                                color: '#f1f5f9'
                            },
                            ticks: {
                                font: { size: 11 },
                                callback: function (value) {
                                    return Math.round(value).toLocaleString();
                                }
                            }
                        },
                        x: {
                            grid: {
                                display: false
                            },
                            ticks: {
                                font: { size: 11 }
                            }
                        }
                    }
                }
            });
        }

        function createLoginView() {
            const container = document.createElement('div');
            container.className = 'min-h-screen flex flex-col md:flex-row w-full font-sans';

            // Left Panel (Desktop Only)
            const leftPanel = document.createElement('div');
            leftPanel.className = 'hidden md:flex md:w-1/2 bg-brandNavy flex-col items-center justify-center p-12 text-center relative overflow-hidden text-white';
            leftPanel.innerHTML = `
                <div class="absolute top-[-10%] left-[-10%] w-96 h-96 bg-white/5 rounded-full blur-3xl"></div>
                <div class="z-10 flex flex-col items-center gap-8 animate-fadeIn">
                    <div class="space-y-4 mb-8">
                        <h1 class="text-4xl font-bold tracking-wider">파트너스본부</h1>
                        <p class="text-gray-300 text-lg font-light leading-relaxed">
                            성공적인 영업을 위한 지원 플랫폼<br>
                            언제 어디서나 쉽고 빠르게 조회하세요
                        </p>
                    </div>

                    <div class="space-y-6 w-full max-w-sm text-left">
                        <div class="flex items-center gap-4 bg-white/5 p-4 rounded-2xl border border-white/10 backdrop-blur-sm">
                            <div class="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                                <svg class="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                            </div>
                            <div>
                                <h3 class="font-bold text-base">강력한 영업 지원</h3>
                                <p class="text-xs text-gray-400">영업 활동에 필요한 다양한 정보 제공</p>
                            </div>
                        </div>
                        <div class="flex items-center gap-4 bg-white/5 p-4 rounded-2xl border border-white/10 backdrop-blur-sm">
                            <div class="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                                <svg class="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
                            </div>
                            <div>
                                <h3 class="font-bold text-base">투명한 시상금 조회</h3>
                                <p class="text-xs text-gray-400">정확한 데이터 기반의 시상금 내역 확인</p>
                            </div>
                        </div>
                        <div class="flex items-center gap-4 bg-white/5 p-4 rounded-2xl border border-white/10 backdrop-blur-sm">
                            <div class="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                                <svg class="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
                            </div>
                            <div>
                                <h3 class="font-bold text-base">체계적인 증원 관리</h3>
                                <p class="text-xs text-gray-400">증원수당 및 산하 파트너 현황 확인</p>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // Right Panel
            const rightPanel = document.createElement('div');
            rightPanel.className = 'w-full md:w-1/2 bg-white flex flex-col h-screen md:h-auto overflow-y-auto';
            rightPanel.innerHTML = `
                <div class="flex-grow flex items-center justify-center p-6 sm:p-12">
                     <div class="w-[85%] md:w-full max-w-sm space-y-10 animate-fadeIn mx-auto">
                        
                        <!-- Mobile Header Logo -->
                        <div class="md:hidden text-center mb-10 mt-16">
                            <h1 class="text-2xl font-bold text-gray-800 tracking-tight">파트너스본부</h1>
                        </div>

                        <!-- Main Title -->
                        <div class="text-center space-y-2">
                             <h2 class="text-3xl font-extrabold text-gray-900 tracking-tight">PARTNERS <span class="text-primary">BOARD</span></h2>
                             <p class="text-gray-400 text-sm">계정 정보를 입력해 주세요</p>
                        </div>
                        
                        <form id="loginForm" class="space-y-6">
                            <div class="space-y-2">
                                <label class="block text-sm font-bold text-gray-700 text-left">사번</label>
                                <input type="text" id="staffId" placeholder="사번을 입력하세요" class="w-full px-4 py-3.5 rounded-lg border border-gray-200 bg-white focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition duration-200 placeholder-gray-400 text-center" required>
                            </div>
                            <div class="space-y-2">
                                <label class="block text-sm font-bold text-gray-700 text-left">비밀번호</label>
                                <input type="password" id="password" placeholder="비밀번호를 입력하세요" class="w-full px-4 py-3.5 rounded-lg border border-gray-200 bg-white focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition duration-200 placeholder-gray-400 text-center" required>
                            </div>
                            <button type="submit" class="w-full bg-primary text-white font-bold py-4 rounded-lg hover:bg-primaryHover hover:shadow-lg transition duration-200 text-lg">로그인</button>
                        </form>
                        
                        <!-- PWA 앱 설치 유도 배너 -->
                        ${checkStandalone() ? '' : `
                        <div id="pwa-install-section" class="bg-indigo-50/50 border border-indigo-100 p-5 rounded-2xl space-y-4">
                            <div class="flex items-center gap-3">
                                <div class="p-2 bg-indigo-100 rounded-xl text-primary">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                                </div>
                                <div class="text-left">
                                    <p class="text-sm font-bold text-gray-800">앱으로 더욱 편리하게</p>
                                    <p class="text-xs text-gray-500">홈 화면에 바로가기를 추가해 보세요</p>
                                </div>
                            </div>
                            <button id="pwa-install-btn" onclick="triggerPwaInstall()" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl shadow-md shadow-indigo-100 transition duration-200 text-sm flex items-center justify-center gap-2">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                                파트너스 보드 설치하기
                            </button>
                            <button onclick="togglePwaGuide(true)" class="w-full bg-white hover:bg-gray-50 border border-gray-200 text-gray-600 font-bold py-2.5 rounded-xl transition duration-200 text-xs">
                                기기별 설치 방법 안내
                            </button>
                        </div>
                        `}
                        
                        <div class="pt-4 text-center">
                            <p class="text-xs text-gray-400 mb-2">도움이 필요하신가요?</p>
                            <p class="text-xs text-gray-400">로그인에 문제가 있으시면 관리자에게 문의하세요</p>
                            <p class="text-xs text-gray-300 mt-8 font-light">© 2024 파트너스본부. All rights reserved.</p>
                        </div>
                    </div>
                </div>
            `;

            container.appendChild(leftPanel);
            container.appendChild(rightPanel);

            setTimeout(() => {
                const form = container.querySelector('#loginForm');
                if (form) form.addEventListener('submit', e => {
                    e.preventDefault();
                    doLogin(container.querySelector('#staffId').value, container.querySelector('#password').value);
                });
            }, 0);
            return container;
        }

        function createLayout() {
            const container = document.createElement('div');
            container.className = 'flex flex-col md:flex-row min-h-screen bg-[#f8fafc]';

            const monthOptions = state.months.map(m => `<option value="${m}" ${m === state.currentMonth ? 'selected' : ''}>${m}</option>`).join('');

            // Desktop Month Selector
            const monthSel = `<div class="relative"><select id="commonMonthSelect" class="appearance-none bg-gray-50 border border-gray-200 text-gray-700 text-sm font-bold rounded-xl shadow-sm hover:border-gray-300 focus:ring-2 focus:ring-primary/20 focus:border-primary block pl-3 pr-8 py-2 cursor-pointer transition">
                ${monthOptions}
            </select><div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500"><svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg></div></div>`;

            // Mobile Month Selector
            const mobileMonthSel = `<div class="relative w-full"><select id="mobileMonthSelect" class="appearance-none w-full bg-white border border-gray-200 text-gray-900 text-base rounded-xl shadow-sm focus:ring-2 focus:ring-primary/20 focus:border-primary block pl-4 pr-10 py-3 cursor-pointer transition">
                ${monthOptions}
            </select><div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-gray-500"><svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg></div></div>`;

            const sidebarLink = (v, l, icon) => `
                <a href="#" data-nav="${v}" class="nav-sidebar-link ${state.currentView === v ? 'active' : ''}">
                    <span class="mr-3">${icon}</span>
                    <span>${l}</span>
                </a>`;

            const icons = {
                home: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path></svg>',
                lapse: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>',
                dashboard: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
                recruitment: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>',
                activity: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path></svg>',
                admin: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>',
                branch: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>',
                lapseAdmin: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>',
                retentionAdmin: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
                performanceAnalysis: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>',
                bondAdmin: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path></svg>',
                totalAllowanceForecast: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>',
                rewardAdjust: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"></path></svg>'
            };

            container.innerHTML = `
                <!-- PC Sidebar -->
                <aside class="hidden lg:flex flex-col w-64 bg-secondary text-white fixed h-full z-50 shadow-2xl sidebar-fixed">
                    <div class="p-6 mb-4">
                        <div class="flex items-center gap-3 cursor-pointer" onclick="navigate('home')">
                            <div class="bg-primary/20 p-2 rounded-xl">
                                <svg class="w-6 h-6 text-primary" fill="currentColor" viewBox="0 0 20 20"><path d="M2 10a8 8 0 018-8v8h8a8 8 0 11-16 0z"></path><path d="M12 2.252A8.014 8.014 0 0117.748 8H12V2.252z"></path></svg>
                            </div>
                            <span class="text-xl font-black tracking-tighter">PARTNERS <span class="text-primary">BOARD</span></span>
                        </div>
                    </div>
                    
                    <nav class="flex-grow space-y-1 overflow-y-auto sidebar-scroll pb-20">
                        <div class="px-6 py-2">
                             <p class="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-4 ml-1">Main Menu</p>
                             ${sidebarLink('home', '홈', icons.home)}
                             ${!hasRole('실장') ? sidebarLink('lapse', '계약유지관리', icons.lapse) : ''}
                             ${!hasRole('실장') ? sidebarLink('dashboard', '시상금', icons.dashboard) : ''}
                             ${(state.user.isRecruiter && !hasRole('실장')) ? sidebarLink('recruitment', '증원수당', icons.recruitment) : ''}
                        </div>

                        ${(isBranchRepAny() || isAdminAny() || hasRole('실장') || isOpsAny() || isForecastAllowed()) ? `
                        <div class="px-6 py-4 mt-2">
                             <p class="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-4 ml-1">Administration</p>
                             ${(isBranchRepAny() || isOpsAny() || isAdminAny()) ? sidebarLink('admin', '관리자', icons.admin) : ''}
                             ${isBranchRepAny() ? sidebarLink('branch', '지사대표', icons.branch) : ''}
                             ${(isBranchRepAny() || isAdminAny() || hasRole('실장') || isOpsAny()) ? sidebarLink('lapseAdmin', '실효연체관리', icons.lapseAdmin) : ''}
                             ${(isBranchRepAny() || isAdminAny() || hasRole('실장') || isOpsAny()) ? sidebarLink('retentionAdmin', '유지율', icons.retentionAdmin) : ''}
                             ${isBranchRepAny() ? sidebarLink('bondAdmin', '채권관리', icons.bondAdmin) : ''}
                             ${(isBranchRepAny() || isOpsAny() || hasRole('실장') || hasRole('실적분석')) ? sidebarLink('performanceAnalysis', '실적분석', icons.performanceAnalysis) : ''}
                             ${isForecastAllowed() ? sidebarLink('totalAllowanceForecast', '총수당예상', icons.totalAllowanceForecast) : ''}
                             ${isBranchRepAny() ? sidebarLink('rewardAdjust', '시상조정', icons.rewardAdjust) : ''}
                        </div>` : ''}
                    </nav>

                    <div class="p-6 bg-slate-900/50 mt-auto border-t border-white/5">
                        <div class="flex items-center gap-3 mb-4">
                            <div class="w-10 h-10 rounded-full bg-primary flex items-center justify-center font-bold text-white shadow-lg">
                                ${state.user.name.substring(0, 1)}
                            </div>
                            <div class="overflow-hidden">
                                <p class="text-sm font-bold truncate">${state.user.name}</p>
                                <p class="text-[10px] text-slate-400 truncate">${state.user.organization || '파트너스본부'}</p>
                            </div>
                        </div>
                        <div class="grid grid-cols-2 gap-2">
                            <button id="changePwBtn" class="flex items-center justify-center gap-2 p-2.5 rounded-xl bg-white/5 hover:bg-white/10 transition group" title="비밀번호 변경">
                                <svg class="w-4 h-4 text-slate-400 group-hover:text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"></path></svg>
                                <span class="text-[10px] font-bold text-slate-300 group-hover:text-white">비밀번호</span>
                            </button>
                            <button id="logout" class="flex items-center justify-center gap-2 p-2.5 rounded-xl bg-white/5 hover:bg-red-500/20 transition group" title="로그아웃">
                                <svg class="w-4 h-4 text-slate-400 group-hover:text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
                                <span class="text-[10px] font-bold text-slate-300 group-hover:text-white">로그아웃</span>
                            </button>
                        </div>
                    </div>
                </aside>

                <!-- Main Content Area -->
                <div class="flex flex-col flex-1 w-full main-content-area">
                    <!-- Top Navigation Bar (Mobile Toggle + PC Breadcrumb/UserInfo) -->
                    <header class="bg-white/80 backdrop-blur-md shadow-sm h-16 sticky top-0 z-40 flex items-center justify-between px-4 md:px-8 lg:px-10 header-area">
                        <div class="flex items-center gap-4">
                            <!-- Mobile Menu Toggle -->
                            <button id="mb-btn" class="lg:hidden p-2 rounded-xl text-gray-600 hover:bg-gray-100 transition active:scale-95">
                                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16m-7 6h7"></path></svg>
                            </button>
                            <!-- Logo for Mobile only in Header -->
                            <div class="lg:hidden flex items-center gap-2 cursor-pointer" onclick="navigate('home')">
                                <span class="text-lg font-black tracking-tighter">PARTNERS <span class="text-primary">BOARD</span></span>
                            </div>
                            <!-- Breadcrumb-like for Desktop -->
                            <div class="hidden lg:flex items-center text-sm font-medium text-gray-500">
                                <span class="hover:text-primary cursor-pointer" onclick="navigate('home')">Dashboard</span>
                                <svg class="w-4 h-4 mx-2 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                                <span class="text-gray-900 font-bold">
                                    ${(() => {
                                        const viewMap = {
                                            home: '홈',
                                            lapse: '계약유지관리',
                                            dashboard: '시상금',
                                            recruitment: '증원수당',
                                            admin: '관리자',
                                            branch: '지사대표',
                                            lapseAdmin: '실효연체관리',
                                            retentionAdmin: '유지율',
                                            bondAdmin: '채권관리',
                                            performanceAnalysis: '실적분석',
                                            totalAllowanceForecast: '총수당예상',
                                            rewardAdjust: '시상조정'
                                        };
                                        return viewMap[state.currentView] || '시스템';
                                    })()}
                                </span>
                            </div>
                        </div>

                        <div class="flex items-center gap-3 md:gap-6">
                            <div class="flex items-center">
                                <span class="hidden md:inline-block text-xs font-bold text-slate-400 mr-3 uppercase tracking-wider">마감월</span>
                                ${monthSel}
                            </div>
                            <div class="h-8 w-px bg-gray-100 hidden md:block"></div>
                            <div class="hidden md:flex items-center gap-3">
                                <div class="text-right leading-none">
                                    <p class="text-sm font-bold text-gray-900">${state.user.name}</p>
                                    <p class="text-[10px] text-gray-400 mt-1">${state.user.organization || '파트너스본부'}</p>
                                </div>
                            </div>
                        </div>
                    </header>

                    <!-- Page View Container -->
                    <main class="flex-1 p-4 md:p-8 lg:p-10 animate-fadeIn">
                        <div id="main-view" class="max-w-full"></div>
                    </main>

                    <!-- Mobile Bottom Spacer for FAB -->
                    <div class="h-20 md:hidden"></div>
                </div>

                <!-- Mobile Navigation (Bottom Drawer or Full Screen) -->
                <div id="mobile-menu" class="lg:hidden fixed inset-0 z-50 transform -translate-x-full transition-transform duration-300 pointer-events-none">
                    <div class="absolute inset-0 bg-black/50 pointer-events-auto" id="mobile-backdrop"></div>
                    <nav class="absolute top-0 left-0 h-full w-[80%] max-w-sm bg-white shadow-2xl flex flex-col pointer-events-auto">
                        <div class="p-6 border-b border-gray-100 flex items-center justify-between">
                            <span class="text-xl font-black">MENU</span>
                            <button id="mobile-close" class="p-2"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
                        </div>
                        <div class="p-4 border-b border-gray-100 bg-orange-50/50">
                             <p class="text-xs font-bold text-primary mb-3 ml-1 uppercase">마감월 선택</p>
                             ${mobileMonthSel}
                        </div>
                        <div class="flex-grow overflow-y-auto p-4 space-y-2">
                            <a href="#" data-nav="home" class="flex items-center p-4 rounded-xl text-lg font-bold ${state.currentView === 'home' ? 'bg-primary text-white shadow-lg' : 'text-gray-600 active:bg-gray-100'} transition">
                                <span class="mr-4">${icons.home}</span> 홈
                            </a>
                            ${!hasRole('실장') ? `<a href="#" data-nav="lapse" class="flex items-center p-4 rounded-xl text-lg font-bold ${state.currentView === 'lapse' ? 'bg-primary text-white shadow-lg' : 'text-gray-600 active:bg-gray-100'} transition">
                                <span class="mr-4">${icons.lapse}</span> 계약유지관리
                            </a>` : ''}
                            ${!hasRole('실장') ? `<a href="#" data-nav="dashboard" class="flex items-center p-4 rounded-xl text-lg font-bold ${state.currentView === 'dashboard' ? 'bg-primary text-white shadow-lg' : 'text-gray-600 active:bg-gray-100'} transition">
                                <span class="mr-4">${icons.dashboard}</span> 시상금
                            </a>` : ''}
                            ${(state.user.isRecruiter && !hasRole('실장')) ? `<a href="#" data-nav="recruitment" class="flex items-center p-4 rounded-xl text-lg font-bold ${state.currentView === 'recruitment' ? 'bg-primary text-white shadow-lg' : 'text-gray-600 active:bg-gray-100'} transition">
                                <span class="mr-4">${icons.recruitment}</span> 증원수당
                            </a>` : ''}
                            <div class="h-px bg-gray-100 my-4"></div>
                            ${(isBranchRepAny() || isOpsAny() || isAdminAny()) ? `<a href="#" data-nav="admin" class="flex items-center p-4 rounded-xl text-lg font-bold ${state.currentView === 'admin' ? 'bg-primary text-white shadow-lg' : 'text-gray-600 active:bg-gray-100'} transition">
                                <span class="mr-4">${icons.admin}</span> 관리자
                            </a>` : ''}
                            ${isBranchRepAny() ? `<a href="#" data-nav="branch" class="flex items-center p-4 rounded-xl text-lg font-bold ${state.currentView === 'branch' ? 'bg-primary text-white shadow-lg' : 'text-gray-600 active:bg-gray-100'} transition">
                                <span class="mr-4">${icons.branch}</span> 지사대표
                            </a>` : ''}
                            ${(isBranchRepAny() || isAdminAny() || hasRole('실장') || isOpsAny()) ? `<a href="#" data-nav="lapseAdmin" class="flex items-center p-4 rounded-xl text-lg font-bold ${state.currentView === 'lapseAdmin' ? 'bg-primary text-white shadow-lg' : 'text-gray-600 active:bg-gray-100'} transition">
                                <span class="mr-4">${icons.lapseAdmin}</span> 실효연체관리
                            </a>` : ''}
                            ${(isBranchRepAny() || isAdminAny() || hasRole('실장') || isOpsAny()) ? `<a href="#" data-nav="retentionAdmin" class="flex items-center p-4 rounded-xl text-lg font-bold ${state.currentView === 'retentionAdmin' ? 'bg-primary text-white shadow-lg' : 'text-gray-600 active:bg-gray-100'} transition">
                                <span class="mr-4">${icons.retentionAdmin}</span> 유지율
                            </a>` : ''}
                            ${isBranchRepAny() ? `<a href="#" data-nav="bondAdmin" class="flex items-center p-4 rounded-xl text-lg font-bold ${state.currentView === 'bondAdmin' ? 'bg-primary text-white shadow-lg' : 'text-gray-600 active:bg-gray-100'} transition">
                                <span class="mr-4">${icons.bondAdmin}</span> 채권관리
                            </a>` : ''}
                            ${(isBranchRepAny() || isOpsAny() || hasRole('실장') || hasRole('실적분석')) ? `<a href="#" data-nav="performanceAnalysis" class="flex items-center p-4 rounded-xl text-lg font-bold ${state.currentView === 'performanceAnalysis' ? 'bg-primary text-white shadow-lg' : 'text-gray-600 active:bg-gray-100'} transition">
                                <span class="mr-4">${icons.performanceAnalysis}</span> 실적분석
                            </a>` : ''}
                            ${isForecastAllowed() ? `<a href="#" data-nav="totalAllowanceForecast" class="flex items-center p-4 rounded-xl text-lg font-bold ${state.currentView === 'totalAllowanceForecast' ? 'bg-primary text-white shadow-lg' : 'text-gray-600 active:bg-gray-100'} transition">
                                <span class="mr-4">${icons.totalAllowanceForecast}</span> 총수당예상
                            </a>` : ''}
                            ${isBranchRepAny() ? `<a href="#" data-nav="rewardAdjust" class="flex items-center p-4 rounded-xl text-lg font-bold ${state.currentView === 'rewardAdjust' ? 'bg-primary text-white shadow-lg' : 'text-gray-600 active:bg-gray-100'} transition">
                                <span class="mr-4">${icons.rewardAdjust}</span> 시상조정
                            </a>` : ''}
                        </div>
                        <div class="p-6 border-t border-gray-100 grid grid-cols-2 gap-3">
                             <button id="changePwBtnM" class="flex items-center justify-center p-4 bg-gray-50 text-gray-600 font-bold rounded-2xl active:bg-gray-100 text-sm">
                                비밀번호
                             </button>
                             <button id="logoutM" class="flex items-center justify-center p-4 bg-primary text-white font-bold rounded-2xl shadow-lg text-sm">
                                로그아웃
                             </button>
                        </div>
                    </nav>
                </div>

                <!-- Mobile FAB -->
                <div class="mobile-fab-container">
                    <button type="button" class="fab-btn" onclick="navigate('home')">
                        <span class="fab-text">홈</span>
                    </button>
                    <button type="button" class="fab-btn" onclick="handleFabBack()">
                        <span class="fab-icon">←</span>
                        <span class="fab-text">이전</span>
                    </button>
                </div>
            `;

            const main = container.querySelector('#main-view');
            // Logic reuse
            if (state.currentView === 'home') main.appendChild(createHomeView());
            else if (state.currentView === 'lapse') main.appendChild(createLapseView());
            else if (state.currentView === 'dashboard') main.appendChild(createDashboardView());
            else if (state.currentView === 'recruitment') main.appendChild(createRecruitmentView());
            else if (state.currentView === 'activity') main.appendChild(createActivityView());
            else if (state.currentView === 'branch') main.appendChild(createBranchView());
            else if (state.currentView === 'admin') main.appendChild(createAdminView());
            else if (state.currentView === 'lapseAdmin') main.appendChild(createLapseAdminView());
            else if (state.currentView === 'retentionAdmin') main.appendChild(createRetentionAdminView());
            else if (state.currentView === 'bondAdmin') main.appendChild(createBondAdminView());
            else if (state.currentView === 'performanceAnalysis') main.appendChild(createPerformanceAnalysisView());
            else if (state.currentView === 'totalAllowanceForecast') main.appendChild(createTotalAllowanceForecastView());
            else if (state.currentView === 'rewardAdjust') main.appendChild(createRewardAdjustView());

            setTimeout(() => {
                container.querySelectorAll('#commonMonthSelect, #mobileMonthSelect').forEach(e => e.addEventListener('change', ev => {
                    state.currentMonth = ev.target.value;
                    saveSession();
                    refresh();
                }));
                // Using event delegation for nav items to handle dynamic content safety
                container.querySelectorAll('[data-nav]').forEach(e => e.addEventListener('click', ev => {
                    ev.preventDefault();
                    const view = ev.currentTarget.getAttribute('data-nav');
                    if (view) navigate(view);
                }));

                const mbBtn = container.querySelector('#mb-btn');
                const mMenu = container.querySelector('#mobile-menu');
                const backdrop = container.querySelector('#mobile-backdrop');
                const closeBtn = container.querySelector('#mobile-close');

                const toggleMenu = (open) => {
                    if (open) {
                        mMenu.classList.remove('pointer-events-none');
                        mMenu.classList.remove('-translate-x-full');
                    } else {
                        mMenu.classList.add('-translate-x-full');
                        setTimeout(() => mMenu.classList.add('pointer-events-none'), 300);
                    }
                };

                if (mbBtn) mbBtn.onclick = () => toggleMenu(true);
                if (backdrop) backdrop.onclick = () => toggleMenu(false);
                if (closeBtn) closeBtn.onclick = () => toggleMenu(false);

                container.querySelector('#logout')?.addEventListener('click', () => logout());
                container.querySelector('#logoutM')?.addEventListener('click', () => logout());
                container.querySelector('#changePwBtn')?.addEventListener('click', () => openChangePasswordModal(true));
                container.querySelector('#changePwBtnM')?.addEventListener('click', () => openChangePasswordModal(true));

                // Always try to ensure Lapse data is synced visually if loaded
                if (state.lapseLoaded) {
                    const lCount = container.querySelector('#home-lapsed-count');
                    const aCount = container.querySelector('#home-arrears-count');
                    const uCount = container.querySelector('#home-unpaid-count');
                    if (lCount) lCount.innerHTML = state.lapseData.lapsed.length + '<span class="text-lg ml-0.5 font-bold">건</span>';
                    if (aCount) aCount.innerHTML = state.lapseData.arrears.length + '<span class="text-lg ml-0.5 font-bold">건</span>';
                    if (uCount) uCount.innerHTML = state.lapseData.unpaid.length + '<span class="text-lg ml-0.5 font-bold">건</span>';
                }
            }, 0);
            return container;
        }

        window.switchLapseTab = function (tab) {
            state.lapseCurrentTab = tab;
            state.lapseLimit = 20; // reset pagination limit
            const container = document.getElementById('lapse-container');
            let data = [];
            if (tab === 'arrears') data = state.lapseData.arrears;
            else if (tab === 'unpaid') data = state.lapseData.unpaid;
            else if (tab === 'unsubmitted') data = state.lapseData.unsubmitted;
            else data = state.lapseData.lapsed;
            renderLapseContents(container, data);

            // Update Base Date Text in Title
            const dateEl = document.querySelector('h2.text-xl.font-bold span.text-gray-400') || document.querySelector('h2.tracking-tight span.text-gray-400');
            if (dateEl) {
                let dateStr = '';
                if (tab === 'arrears') dateStr = state.lapseData.arrearsDate;
                else if (tab === 'unpaid') dateStr = state.lapseData.unpaidDate;
                else if (tab === 'unsubmitted') dateStr = state.lapseData.unsubmittedDate;
                else dateStr = state.lapseData.lapsedDate;
                dateEl.innerText = dateStr ? `(${formatBaseDate(dateStr)} 기준)` : '';
            }

            // Update Tab UI
            const btnLapsed = document.getElementById('tab-btn-lapsed');
            const btnArrears = document.getElementById('tab-btn-arrears');
            const btnUnpaid = document.getElementById('tab-btn-unpaid');
            const btnUnsubmitted = document.getElementById('tab-btn-unsubmitted');

            [btnLapsed, btnArrears, btnUnpaid, btnUnsubmitted].forEach(btn => {
                if (!btn) return;
                btn.className = 'flex-1 py-3 text-sm font-medium text-gray-500 hover:text-gray-700 transition';
            });

            if (tab === 'lapsed') {
                if (btnLapsed) btnLapsed.className = 'flex-1 py-3 text-sm font-bold bg-white text-red-600 shadow-sm rounded-xl transition';
            } else if (tab === 'arrears') {
                if (btnArrears) btnArrears.className = 'flex-1 py-3 text-sm font-bold bg-white text-orange-600 shadow-sm rounded-xl transition';
            } else if (tab === 'unpaid') {
                if (btnUnpaid) btnUnpaid.className = 'flex-1 py-3 text-sm font-bold bg-white text-blue-600 shadow-sm rounded-xl transition';
            } else if (tab === 'unsubmitted') {
                if (btnUnsubmitted) btnUnsubmitted.className = 'flex-1 py-3 text-sm font-bold bg-white text-indigo-600 shadow-sm rounded-xl transition';
            }
        };

        function createLapseView() {
            if (state.isLoading) return getSkeletonUI();
            const div = document.createElement('div');

            // 현재 선택된 탭에 맞춰 초기 기준일 결정
            let initialDate = '';
            const curTab = state.lapseCurrentTab || 'lapsed';
            if (curTab === 'arrears') initialDate = state.lapseData.arrearsDate;
            else if (curTab === 'unpaid') initialDate = state.lapseData.unpaidDate;
            else if (curTab === 'unsubmitted') initialDate = state.lapseData.unsubmittedDate;
            else initialDate = state.lapseData.lapsedDate;

            div.innerHTML = `
                <div class="mb-4">
                    <h2 class="text-xl font-bold text-gray-800 tracking-tight">계약유지관리${initialDate ? ' <span class="text-sm font-normal text-gray-400">(' + formatBaseDate(initialDate) + ' 기준)</span>' : ''}</h2>
                    <p class="text-gray-500 text-sm mt-1">당월 실효 및 연체계약 관리 페이지입니다.</p>
                </div>
                
                <div class="bg-gray-100 p-1.5 rounded-2xl flex mb-6 max-w-lg mx-auto md:mx-0">
                    <button id="tab-btn-lapsed" onclick="switchLapseTab('lapsed')" class="${state.lapseCurrentTab === 'lapsed' ? 'flex-1 py-3 text-sm font-bold bg-white text-red-600 shadow-sm rounded-xl transition' : 'flex-1 py-3 text-sm font-medium text-gray-500 hover:text-gray-700 transition'}">당월 실효</button>
                    <button id="tab-btn-arrears" onclick="switchLapseTab('arrears')" class="${state.lapseCurrentTab === 'arrears' ? 'flex-1 py-3 text-sm font-bold bg-white text-orange-600 shadow-sm rounded-xl transition' : 'flex-1 py-3 text-sm font-medium text-gray-500 hover:text-gray-700 transition'}">당월 연체</button>
                    <button id="tab-btn-unpaid" onclick="switchLapseTab('unpaid')" class="${state.lapseCurrentTab === 'unpaid' ? 'flex-1 py-3 text-sm font-bold bg-white text-blue-600 shadow-sm rounded-xl transition' : 'flex-1 py-3 text-sm font-medium text-gray-500 hover:text-gray-700 transition'}">당월 미납</button>
                    <button id="tab-btn-unsubmitted" onclick="switchLapseTab('unsubmitted')" class="${state.lapseCurrentTab === 'unsubmitted' ? 'flex-1 py-3 text-sm font-bold bg-white text-indigo-600 shadow-sm rounded-xl transition' : 'flex-1 py-3 text-sm font-medium text-gray-500 hover:text-gray-700 transition'}">확인서 미제출</button>
                </div>
                
                <div id="lapse-container" class="min-h-[400px]">
                     <div class="flex items-center justify-center h-40">
                         <div class="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                     </div>
                </div>
            `;

            // Fetch data and render
            setTimeout(async () => {
                const container = div.querySelector('#lapse-container');

                if (!state.lapseData || (!state.lapseData.lapsed?.length && !state.lapseData.arrears?.length && !state.lapseData.unpaid?.length && !state.lapseData.unsubmitted?.length)) {
                    container.innerHTML = getSkeletonUI().innerHTML;
                    const res = await callApi('getLapseManagementData', state.user.staffId, 'collector');

                    if (res.error || !res.success) {
                        container.innerHTML = `<div class="p-8 text-center text-red-500 bg-red-50 rounded-2xl border border-red-100">데이터를 불러오지 못했습니다.<br><span class="text-sm">${res.message || '네트워크 오류'}</span></div>`;
                        return;
                    }
                    state.lapseData = { lapsed: res.lapsed || [], arrears: res.arrears || [], unpaid: res.unpaid || [], unsubmitted: res.unsubmitted || [], lapsedDate: res.lapsedDate, arrearsDate: res.arrearsDate, unpaidDate: res.unpaidDate, unsubmittedDate: res.unsubmittedDate };
                    
                    // API 로드 후 헤더의 기준일 다시 업데이트
                    const dateEl = div.querySelector('h2.text-xl.font-bold span.text-gray-400');
                    if (dateEl) {
                        let dateStr = '';
                        const curTab = state.lapseCurrentTab || 'lapsed';
                        if (curTab === 'arrears') dateStr = state.lapseData.arrearsDate;
                        else if (curTab === 'unpaid') dateStr = state.lapseData.unpaidDate;
                        else if (curTab === 'unsubmitted') dateStr = state.lapseData.unsubmittedDate;
                        else dateStr = state.lapseData.lapsedDate;
                        dateEl.innerText = dateStr ? `(${formatBaseDate(dateStr)} 기준)` : '';
                    }
                }

                let dataToRender = [];
                if (state.lapseCurrentTab === 'arrears') dataToRender = state.lapseData.arrears;
                else if (state.lapseCurrentTab === 'unpaid') dataToRender = state.lapseData.unpaid;
                else if (state.lapseCurrentTab === 'unsubmitted') dataToRender = state.lapseData.unsubmitted;
                else dataToRender = state.lapseData.lapsed;

                renderLapseContents(container, dataToRender);
            }, 10);

            return div;
        }

        function renderLapseContents(container, data) {
            const isArrears = state.lapseCurrentTab === 'arrears';
            const isUnpaid = state.lapseCurrentTab === 'unpaid';
            const isUnsubmitted = state.lapseCurrentTab === 'unsubmitted';
            const colorClass = isUnsubmitted ? 'indigo' : (isUnpaid ? 'blue' : (isArrears ? 'orange' : 'red'));
            const titleText = isUnsubmitted ? '신계약 확인서 미제출 리스트' : (isUnpaid ? '당월 미납계약 리스트' : (isArrears ? '당월 연체계약 리스트' : '당월 실효계약 리스트'));

            if (!data || data.length === 0) {
                container.innerHTML = `<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center text-gray-500">해당하는 계약 내역이 없습니다.</div>`;
                return;
            }

            const limit = state.lapseLimit || 20;
            const limitedData = data.slice(0, limit);
            const hasMore = data.length > limit;

            // Desktop Table Layout
            const desktopRows = limitedData.map((x, idx) => {
                if (isUnsubmitted) {
                    return `
                     <tr class="border-b border-gray-100 hover:bg-gray-50 transition">
                       <td class="p-3 text-center">
                           <span class="px-2 py-1 text-[10px] font-bold rounded-lg bg-red-50 text-red-600 border border-red-100">미제출</span>
                       </td>
                       <td class="p-3 text-center text-gray-700">${x['모집인']}</td>
                       <td class="p-3 text-gray-700">${x['보험사']}</td>
                       <td class="p-3 text-xs text-gray-500 font-mono">${maskPolicyNo(x['증권번호'])}</td>
                       <td class="p-3 font-medium text-gray-800"><div class="truncate-product" title="${x['상품명']}">${x['상품명']}</div></td>
                       <td class="p-3 text-right font-medium text-blue-600">${formatMoney(x['보험료'])}</td>
                       <td class="p-3 text-xs text-gray-500">${x['계약일']}</td>
                       <td class="p-3 text-center font-medium text-gray-700">${maskContractor(x['계약자'])}</td>
                       <td class="p-3 text-xs text-gray-400 text-center">${x['데이터기준일']}</td>
                     </tr>`;
                } else {
                    return `
                     <tr class="border-b border-gray-100 hover:bg-gray-50 transition">
                       <td class="p-3 text-center">
                           <span class="px-2 py-1 text-[10px] font-bold rounded-lg ${String(x['계약상태']).includes('실효') ? 'bg-red-50 text-red-600 border border-red-100' : (String(x['계약상태']).includes('연체') ? 'bg-orange-50 text-orange-600 border border-orange-100' : 'bg-gray-100 text-gray-600')}">${x['계약상태']}</span>
                       </td>
                       <td class="p-3 text-center text-gray-700">${x['모집인명']}</td>
                       <td class="p-3 text-center font-bold text-gray-800">${x['수금인명']}</td>
                       <td class="p-3 text-gray-700">${x['보험사']}</td>
                       <td class="p-3 text-xs text-gray-500 font-mono">${maskPolicyNo(x['증권번호'])}</td>
                       <td class="p-3 font-medium text-gray-800"><div class="truncate-product" title="${x['상품명']}">${x['상품명']}</div></td>
                       <td class="p-3 text-right font-medium text-blue-600">${formatMoney(x['계속보험료'])}</td>
                       <td class="p-3 text-xs text-gray-500">${x['계약일']}</td>
                       <td class="p-3 text-center text-xs text-gray-600">${x['납입회차']}</td>
                       <td class="p-3 text-center font-semibold bg-gray-50 text-gray-500 font-mono">${x['최종납입월']}</td>
                       <td class="p-3 text-center font-medium text-gray-700">${x['계약자']}</td>
                       <td class="p-3 text-xs text-gray-400 text-center">${x['데이터기준일']}</td>
                     </tr>`;
                }
            }).join('');

            const theadHtml = isUnsubmitted ? `
                <thead class="bg-gray-50 border-b border-gray-100"><tr class="text-left text-gray-600">
                    <th class="p-3 font-semibold text-center">제출여부</th>
                    <th class="p-3 font-semibold text-center">모집인</th>
                    <th class="p-3 font-semibold">보험사</th>
                    <th class="p-3 font-semibold">증권번호</th>
                    <th class="p-3 font-semibold">상품명</th>
                    <th class="p-3 text-right font-semibold">보험료</th>
                    <th class="p-3 font-semibold">계약일</th>
                    <th class="p-3 text-center font-semibold">계약자</th>
                    <th class="p-3 text-center font-semibold">데이터기준일</th>
                </tr></thead>
            ` : `
                <thead class="bg-gray-50 border-b border-gray-100"><tr class="text-left text-gray-600">
                    <th class="p-3 font-semibold text-center">상태</th>
                    <th class="p-3 font-semibold text-center">모집인</th>
                    <th class="p-3 font-semibold text-center text-gray-800">수금인</th>
                    <th class="p-3 font-semibold">보험사</th>
                    <th class="p-3 font-semibold">증권번호</th>
                    <th class="p-3 font-semibold">상품명</th>
                    <th class="p-3 text-right font-semibold">계속보험료</th>
                    <th class="p-3 font-semibold">계약일</th>
                    <th class="p-3 text-center font-semibold">납입회차</th>
                    <th class="p-3 text-center font-semibold">최종납입월</th>
                    <th class="p-3 text-center font-semibold">계약자</th>
                    <th class="p-3 text-center font-semibold">데이터기준일</th>
                </tr></thead>
            `;

            const desktopTable = `
                <div class="hidden md:block bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                    <div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                        <h3 class="font-bold text-gray-800 flex items-center gap-3">
                            <span class="w-1.5 h-5 bg-${colorClass}-400 rounded-full block text-sm"></span>
                            <span>${titleText} <span class="text-xs font-normal text-gray-500 ml-2">(총 <span class="text-${colorClass}-500 font-bold">${data.length}</span>건)</span></span>
                        </h3>
                    </div>
                    <div class="overflow-x-auto w-full">
                        <table class="w-full text-sm whitespace-nowrap min-w-[1000px]">
                            ${theadHtml}
                            <tbody class="divide-y divide-gray-100">${desktopRows}</tbody>
                        </table>
                    </div>
                </div>
            `;

            // Mobile Card Layout
            const mobileCards = limitedData.map((x, idx) => {
                if (isUnsubmitted) {
                    return `
                        <div onclick="openMobileLapseDetail(${idx})" class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 active:scale-[0.98] transition cursor-pointer">
                            <div class="flex justify-between items-center mb-3">
                                <span class="px-2 py-1 text-[10px] font-bold rounded-lg bg-red-50 text-red-600 border border-red-100">미제출</span>
                                <span class="text-xs font-medium text-gray-500">${x['보험사']}</span>
                            </div>
                            <div class="flex justify-between items-end mb-2">
                                <div class="flex-grow pr-3">
                                    <h4 class="font-bold text-gray-800 text-lg mb-0.5">${maskContractor(x['계약자'])} <span class="text-xs font-normal text-gray-500 ml-1">고객님</span></h4>
                                    <p class="text-sm text-gray-600 truncate-product leading-snug w-full max-w-[200px]" title="${x['상품명']}">${x['상품명']}</p>
                                </div>
                            </div>
                            <div class="flex justify-between items-center pt-3 border-t border-gray-50 mt-1">
                                 <div class="text-xs text-gray-400">모집: <span>${x['모집인']}</span></div>
                                 <div class="font-bold text-blue-600 text-[15px]">${formatMoney(x['보험료'])}</div>
                            </div>
                        </div>`;
                } else {
                    return `
                        <div onclick="openMobileLapseDetail(${idx})" class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 active:scale-[0.98] transition cursor-pointer">
                            <div class="flex justify-between items-center mb-3">
                                <span class="px-2 py-1 text-[10px] font-bold rounded-lg ${String(x['계약상태']).includes('실효') ? 'bg-red-50 text-red-600 border border-red-100' : (String(x['계약상태']).includes('연체') ? 'bg-orange-50 text-orange-600 border border-orange-100' : (String(x['계약상태']) === '미납' ? 'bg-blue-50 text-blue-600 border border-blue-100' : 'bg-gray-100 text-gray-600'))}">${x['계약상태']}</span>
                                <span class="text-xs font-medium text-gray-500">${x['보험사']}</span>
                            </div>
                            <div class="flex justify-between items-end mb-2">
                                <div class="flex-grow pr-3">
                                    <h4 class="font-bold text-gray-800 text-lg mb-0.5">${x['계약자']} <span class="text-xs font-normal text-gray-500 ml-1">고객님</span></h4>
                                    <p class="text-sm text-gray-600 truncate-product leading-snug w-full max-w-[200px]" title="${x['상품명']}">${x['상품명']}</p>
                                </div>
                            </div>
                            <div class="flex justify-between items-center pt-3 border-t border-gray-50 mt-1">
                                 <div class="text-xs text-gray-400">최종납: <span class="font-mono">${x['최종납입월']}</span></div>
                                 <div class="font-bold text-blue-600 text-[15px]">${formatMoney(x['계속보험료'])}</div>
                            </div>
                        </div>`;
                }
            }).join('');

            const mobileContainer = `
                <div class="md:hidden flex flex-col gap-3 pb-4">
                     <div class="flex items-center justify-between px-1 mb-1">
                        <span class="text-sm font-bold text-gray-600">총 <span class="text-${colorClass}-500">${data.length}</span>건</span>
                     </div>
                     ${mobileCards}
                </div>
            `;

            let loadMoreHtml = '';
            if (hasMore) {
                loadMoreHtml = `<div class="mt-2 mb-8 flex justify-center w-full">
                    <button onclick="loadMoreLapse()" class="w-full max-w-sm px-6 py-3.5 bg-white border border-gray-200 text-gray-700 font-bold rounded-xl shadow-sm hover:bg-gray-50 hover:border-gray-300 transition-all flex justify-center items-center gap-2">
                        <span>더보기 (${limitedData.length} / ${data.length})</span>
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                </div>`;
            }

            container.innerHTML = desktopTable + mobileContainer + loadMoreHtml;
        }

        window.loadMoreLapse = function () {
            state.lapseLimit += 20;
            const container = document.getElementById('lapse-container');
            let data = [];
            if (state.lapseCurrentTab === 'arrears') data = state.lapseData.arrears;
            else if (state.lapseCurrentTab === 'unpaid') data = state.lapseData.unpaid;
            else if (state.lapseCurrentTab === 'unsubmitted') data = state.lapseData.unsubmitted;
            else data = state.lapseData.lapsed;
            renderLapseContents(container, data);
        };

        window.openMobileLapseDetail = function (idx) {
            let dataList = [];
            if (state.lapseCurrentTab === 'arrears') dataList = state.lapseData.arrears;
            else if (state.lapseCurrentTab === 'unpaid') dataList = state.lapseData.unpaid;
            else if (state.lapseCurrentTab === 'unsubmitted') dataList = state.lapseData.unsubmitted;
            else dataList = state.lapseData.lapsed;
            const data = dataList[idx];
            if (!data) return;

            document.body.classList.add('modal-open');

            const modal = document.createElement('div');
            modal.className = "fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 fade-in";

            const detailRow = (label, val, highlight = false) => `
                <div class="flex justify-between items-center py-2.5 border-b border-gray-50 last:border-0">
                    <span class="text-sm text-gray-500 font-medium">${label}</span>
                    <span class="text-sm text-gray-900 ${highlight ? 'font-bold text-blue-600' : ''} text-right break-words max-w-[65%]">${val}</span>
                </div>
            `;

            const isUnsubmitted = state.lapseCurrentTab === 'unsubmitted';
            const badgeClass = isUnsubmitted ? 'bg-red-50 text-red-600' : (String(data['계약상태']).includes('실효') ? 'bg-red-50 text-red-600' : (String(data['계약상태']).includes('연체') ? 'bg-orange-50 text-orange-600' : 'bg-gray-200 text-gray-700'));
            const badgeText = isUnsubmitted ? '미제출' : data['계약상태'];
            const clientName = isUnsubmitted ? maskContractor(data['계약자']) : data['계약자'];

            modal.innerHTML = `
            <div class="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden transform transition-transform translate-y-0 slide-up">
                <div class="px-5 py-4 border-b border-gray-100 flex justify-between items-center sticky top-0 bg-white/90 backdrop-blur z-10">
                    <h3 class="font-bold text-lg text-gray-800">계약 상세 정보</h3>
                    <button class="close-detail p-2 -mr-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition focus:outline-none"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
                </div>
                <div class="p-5 overflow-y-auto custom-scrollbar flex-grow">
                    <div class="bg-gray-50/50 rounded-xl p-4 border border-gray-100/50 space-y-1 mb-4">
                        <div class="flex justify-between items-start mb-2">
                             <div class="font-bold text-gray-900 text-xl">${clientName}</div>
                             <span class="px-2 py-1 text-[11px] font-bold rounded-md ${badgeClass}">${badgeText}</span>
                        </div>
                        <div class="text-sm font-medium text-gray-700 leading-snug">${data['상품명']}</div>
                        <div class="text-[11px] font-mono text-gray-400 mt-1">${maskPolicyNo(data['증권번호'])} · ${data['보험사']}</div>
                    </div>
                    
                    <div class="px-1 text-sm text-gray-800 mb-6">
                         <div class="font-bold text-gray-900 mb-2 border-b border-gray-100 pb-2">${isUnsubmitted ? '계약 및 확인서 정보' : '납입 및 담당 정보'}</div>
                         ${isUnsubmitted ? `
                             ${detailRow('보험료', formatMoney(data['보험료']), true)}
                             ${detailRow('모집인', `<span class="font-bold">${data['모집인']}</span>`)}
                             ${detailRow('보험사', data['보험사'])}
                             ${detailRow('계약일', data['계약일'])}
                             ${detailRow('제출여부', '미제출')}
                             ${detailRow('데이터기준일', `<span class="text-xs text-gray-400">${data['데이터기준일']}</span>`)}
                         ` : `
                             ${detailRow('계속보험료', formatMoney(data['계속보험료']), true)}
                             ${detailRow('최종납입월', data['최종납입월'])}
                             ${detailRow('납입회차', data['납입회차'])}
                             ${detailRow('계약일', data['계약일'])}
                             ${detailRow('수금인명 (담당)', `<span class="font-bold">${data['수금인명']}</span>`)}
                             ${detailRow('모집인명', data['모집인명'])}
                             ${detailRow('데이터기준일', `<span class="text-xs text-gray-400">${data['데이터기준일']}</span>`)}
                         `}
                    </div>
                </div>
                <div class="p-4 bg-white border-t border-gray-100 safe-area-pb">
                    <button class="close-detail w-full py-3.5 bg-gray-900 hover:bg-black text-white font-bold rounded-xl shadow-lg shadow-gray-200 transition text-base">확인</button>
                </div>
            </div>`;

            document.body.appendChild(modal);
            setTimeout(() => {
                const sheet = modal.querySelector('.slide-up');
                if (sheet) sheet.classList.remove('translate-y-full'); // for potential CSS slide-up animation
            }, 10);

            modal.querySelectorAll('.close-detail').forEach(b => b.onclick = () => {
                modal.classList.add('opacity-0');
                document.body.classList.remove('modal-open');
                setTimeout(() => modal.remove(), 200);
            });
        };

        // 시상금 대시보드: 소속원 선택 후 해당자의 시상금 표시 (지사대표/운영진 전용)
        function isDashboardMemberViewable() {
            if (!state.user) return false;
            return isBranchRepAny() || isOpsAny();
        }

        // 소속원 목록 가져오기 (adminSummary에서)
        function getDashboardMemberList() {
            let dd = state.data.adminSummary;
            if (!dd) {
                const cached = sessionStorage.getItem(`DATA_${state.user.staffId}_${state.currentMonth}_admin`);
                if (cached) { try { dd = JSON.parse(cached); state.data.adminSummary = dd; } catch(e) {} }
            }
            if (!dd || !dd.reward) return [];
            const active = dd.reward.active || [];
            const resigned = dd.reward.resigned || [];
            const all = [...active, ...resigned];
            // 중복 제거 및 가나다순 정렬
            const seen = new Set();
            const unique = all.filter(m => {
                const id = String(m.id || m['사번'] || '');
                if (!id || seen.has(id)) return false;
                seen.add(id);
                return true;
            });
            return unique.sort((a, b) => {
                const nameA = String(a.name || a['이름'] || '');
                const nameB = String(b.name || b['이름'] || '');
                return nameA.localeCompare(nameB, 'ko');
            });
        }

        function getRecruitmentMemberList() {
            let dd = state.data.adminSummary;
            if (!dd) {
                const cached = sessionStorage.getItem(`DATA_${state.user.staffId}_${state.currentMonth}_admin`);
                if (cached) { try { dd = JSON.parse(cached); state.data.adminSummary = dd; } catch(e) {} }
            }
            if (!dd || !dd.recruitment) return [];
            const all = dd.recruitment || [];
            const seen = new Set();
            const unique = all.filter(m => {
                const id = String(m.id || m['사번'] || '');
                if (!id || seen.has(id)) return false;
                seen.add(id);
                return true;
            });
            return unique.sort((a, b) => {
                const nameA = String(a.name || a['이름'] || '');
                const nameB = String(b.name || b['이름'] || '');
                return nameA.localeCompare(nameB, 'ko');
            });
        }

        function renderDashboardContent(div, rewardData, displayName, isLoading) {
            const dataContainer = div.querySelector('#dashboard-data-container');
            if (!dataContainer) return;

            if (isLoading) {
                dataContainer.innerHTML = `
                    <div class="flex items-center justify-center h-48">
                        <div class="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                    </div>`;
                return;
            }

            const d = rewardData?.summary || {};
            const selectedDetails = rewardData?.details || null;
            const keys = ['손보 시상금', '생보 시상금', '본부 시상금', '손보법인 시상금(개인)', '생보법인 시상금(개인)'];
            let totalPay = 0, totalRef = 0;
            keys.forEach(k => {
                const obj = d[k] || { pay: 0, refund: 0 };
                totalPay += obj.pay; totalRef += obj.refund;
            });
            const net = totalPay + totalRef;

            const card = (label, val, color, isRed = false, big = false) => `
              <div class="bg-white rounded-2xl shadow-sm hover:shadow-md transition-all duration-300 p-6 border-l-[6px] ${color} h-full flex flex-col justify-center items-center text-center group">
                 <p class="text-gray-400 text-xs font-bold uppercase tracking-wider group-hover:text-gray-600 transition-colors mb-2">${label}</p>
                 <p class="${big ? 'text-2xl' : 'text-xl'} font-extrabold ${isRed || (val < 0) ? 'text-red-500' : 'text-gray-800'} tracking-tight">${formatMoney(val)}</p>
              </div>`;

            // selectedDetails가 있으면 해당 details를 사용, 없으면 state.data.rewardData.details 사용
            const detailJsArgs = selectedDetails
                ? `openDetail('KEY','TYPE', ${JSON.stringify(selectedDetails).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}, '${displayName}')`
                : null;

            const detailCard = (title, key) => {
                const obj = d[key] || { pay: 0, refund: 0 };
                const subTotal = obj.pay + obj.refund;
                const payClick = selectedDetails
                    ? `openDetail('${key}','pay', window._dashboardCurrentDetails, '${displayName}')`
                    : `openDetail('${key}','pay')`;
                const refClick = selectedDetails
                    ? `openDetail('${key}','refund', window._dashboardCurrentDetails, '${displayName}')`
                    : `openDetail('${key}','refund')`;
                return `<div class="bg-white rounded-2xl shadow-sm hover:shadow-lg transition-all duration-300 p-6 border border-gray-100">
                 <div class="flex justify-between mb-4 border-b border-gray-50 pb-3 items-center">
                     <h3 class="font-bold text-lg text-gray-800 flex items-center gap-2"><div class="w-1.5 h-1.5 rounded-full bg-primary/50"></div>${title}</h3>
                     <span class="text-lg font-bold ${subTotal < 0 ? 'text-red-600' : 'text-gray-800'}">${formatMoney(subTotal)}</span>
                 </div>
                 <div class="grid grid-cols-2 gap-3 text-center">
                    <div class="cursor-pointer hover:bg-blue-50/50 p-2.5 rounded-xl transition border border-transparent hover:border-blue-100 group" onclick="${payClick}">
                        <p class="text-[11px] text-gray-400 font-bold uppercase mb-1">지급</p>
                        <p class="text-base font-bold text-blue-600 group-hover:scale-105 transition-transform">${formatMoney(obj.pay)}</p>
                    </div>
                    <div class="cursor-pointer hover:bg-red-50/50 p-2.5 rounded-xl transition border border-transparent hover:border-red-100 group" onclick="${refClick}">
                        <p class="text-[11px] text-gray-400 font-bold uppercase mb-1">환수</p>
                        <p class="text-base font-bold text-red-500 group-hover:scale-105 transition-transform">${formatMoney(obj.refund)}</p>
                    </div>
                 </div></div>`;
            };

            dataContainer.innerHTML = `
             <div class="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
                 <div class="col-span-2 md:col-span-1">${card('실지급 총액 (세전)', net, 'border-primary', false, true)}</div>
                 <div class="col-span-1">${card('총 지급액', totalPay, 'border-blue-500')}</div>
                 <div class="col-span-1">${card('총 환수액', totalRef, 'border-red-500', true)}</div>
             </div>
             <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                ${detailCard('손보 시상금', '손보 시상금')}
                ${detailCard('생보 시상금', '생보 시상금')}
                ${detailCard('본부 시상금', '본부 시상금')}
                ${((d['손보법인 시상금(개인)']?.pay || 0) + (d['손보법인 시상금(개인)']?.refund || 0)) !== 0 ? detailCard('손보법인 시상금', '손보법인 시상금(개인)') : ''}
                ${((d['생보법인 시상금(개인)']?.pay || 0) + (d['생보법인 시상금(개인)']?.refund || 0)) !== 0 ? detailCard('생보법인 시상금', '생보법인 시상금(개인)') : ''}
             </div>
             <div class="mt-8 text-center"><div class="inline-block px-4 py-2 bg-gray-100 rounded-xl md:rounded-full text-sm text-gray-500 font-medium select-none text-center">💡 Tip: 지급/환수 금액을 클릭하면<br class="md:hidden"> 상세 내역을 볼 수 있습니다.</div></div>`;
        }

        function createDashboardView() {
            if (state.isLoading) return getSkeletonUI();
            const div = document.createElement('div');

            const canViewMembers = isDashboardMemberViewable();
            const selectedMember = state.dashboardSelectedMember;
            const displayName = selectedMember ? selectedMember.name : state.user.name;
            const displayData = state.data.rewardData;

            // 소속원 선택 콤보박스 HTML (단순화된 버전)
            const memberSelectorHtml = canViewMembers ? `
            <div class="relative w-full md:w-[350px]" id="dashboard-member-dropdown-wrapper">
                <div class="relative">
                    <input
                        type="text"
                        id="dashboard-member-search"
                        placeholder="소속원 검색 및 선택..."
                        value="${selectedMember ? selectedMember.name : ''}"
                        autocomplete="off"
                        class="w-full pl-9 pr-10 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition cursor-pointer shadow-sm"
                        readonly
                    />
                    <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                    </div>
                    <div class="absolute inset-y-0 right-0 pr-3 flex items-center gap-1">
                        ${selectedMember ? `
                        <button id="dashboard-member-clear-btn" class="p-1 hover:bg-red-50 rounded-full text-red-400 hover:text-red-600 transition" title="내 시상금 보기">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>` : ''}
                        <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </div>
                </div>
                <!-- 드롭다운 목록 -->
                <div id="dashboard-member-list" class="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 hidden max-h-80 overflow-hidden">
                    <div class="p-2 border-b border-gray-100 bg-gray-50/50">
                        <div class="relative">
                            <input
                                type="text"
                                id="dashboard-member-filter"
                                placeholder="이름으로 찾기..."
                                autocomplete="off"
                                class="w-full pl-8 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                            />
                            <div class="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                                <svg class="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                            </div>
                        </div>
                    </div>
                    <div id="dashboard-member-options" class="overflow-y-auto max-h-60 scrollbar-elegant">
                        <div class="px-4 py-8 text-center"><div class="inline-block w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></div></div>
                    </div>
                </div>
            </div>` : '';

            div.innerHTML = `
             <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                <div>
                   <h2 class="text-xl font-bold text-gray-800 tracking-tight" id="dashboard-title">${displayName}님의 시상금 (${state.currentMonth})</h2>
                   <p class="text-gray-500 text-sm mt-1">해당 월의 시상금 지급 및 환수 현황입니다.</p>
                </div>
                ${memberSelectorHtml}
             </div>

             <div id="dashboard-data-container">
                <div class="flex items-center justify-center h-48">
                    <div class="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                </div>
             </div>`;

            // 전역 상숫값 저장
            window._dashboardCurrentDetails = null;

            const renderCurrentData = (rewardData, loading = false) => {
                window._dashboardCurrentDetails = rewardData?.details || null;
                renderDashboardContent(div, rewardData, displayName, loading);
                const titleEl = div.querySelector('#dashboard-title');
                if (titleEl) titleEl.textContent = `${displayName}님의 시상금 (${state.currentMonth})`;
            };

            // 데이터 로딩 로직
            if (selectedMember) {
                const cacheKey = `DATA_${selectedMember.id}_${state.currentMonth}_dashboard`;
                const cached = sessionStorage.getItem(cacheKey);
                if (cached) {
                    try { renderCurrentData(JSON.parse(cached)); } catch (e) { renderCurrentData(null, true); fetchM(); }
                } else { renderCurrentData(null, true); fetchM(); }
                function fetchM() {
                    callApi('getRewardData', selectedMember.id, state.currentMonth).then(d => {
                        if (!state.user) return;
                        if (d && !d.error) { d.month = state.currentMonth; sessionStorage.setItem(cacheKey, JSON.stringify(d)); }
                        renderCurrentData(d && !d.error ? d : null);
                    });
                }
            } else {
                renderCurrentData(displayData);
            }

            // 드롭다운 기능 설정
            if (canViewMembers) {
                setTimeout(() => {
                    const searchInput = div.querySelector('#dashboard-member-search');
                    const dropdownList = div.querySelector('#dashboard-member-list');
                    const filterInput = div.querySelector('#dashboard-member-filter');
                    const optionsContainer = div.querySelector('#dashboard-member-options');
                    const clearBtn = div.querySelector('#dashboard-member-clear-btn');

                    const renderOptions = (filterText = '') => {
                        const mList = getDashboardMemberList(); // 최신 데이터 기반
                        const fText = filterText.toLowerCase();
                        const filtered = mList.filter(m => String(m.name || m['이름'] || '').toLowerCase().includes(fText));

                        if (!optionsContainer) return;

                        // 본인 항목
                        const mySelfHtml = (!filterText || state.user.name.toLowerCase().includes(fText)) ?
                            `<div class="dash-member-option px-4 py-2.5 cursor-pointer hover:bg-gray-50 text-sm flex items-center gap-2 transition ${!selectedMember ? 'bg-primary/5 font-bold text-primary' : 'text-gray-600'}" data-id="__self__" data-name="${state.user.name}">
                                <div class="w-1.5 h-1.5 rounded-full ${!selectedMember ? 'bg-primary' : 'bg-gray-300'}"></div>
                                ${state.user.name} <span class="text-[10px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded ml-auto">ME</span>
                            </div>` : '';

                        if (filtered.length === 0 && !mySelfHtml) {
                            optionsContainer.innerHTML = `<div class="px-4 py-8 text-center text-gray-400 text-sm italic">검색 결과가 없습니다.</div>`;
                            return;
                        }

                        optionsContainer.innerHTML = mySelfHtml + filtered.map(m => {
                            const id = String(m.id || m['사번'] || '');
                            const name = String(m.name || m['이름'] || '');
                            const isSelected = selectedMember && String(selectedMember.id) === id;
                            return `<div class="dash-member-option px-4 py-2.5 cursor-pointer hover:bg-gray-50 text-sm flex items-center gap-2 transition ${isSelected ? 'bg-primary/5 font-bold text-primary' : 'text-gray-700'}" data-id="${id}" data-name="${name}">
                                <div class="w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-primary' : 'bg-gray-200'}"></div>
                                ${name}
                            </div>`;
                        }).join('');

                        optionsContainer.querySelectorAll('.dash-member-option').forEach(el => {
                            el.onclick = () => {
                                const id = el.getAttribute('data-id');
                                const name = el.getAttribute('data-name');
                                dropdownList.classList.add('hidden');
                                if (id === '__self__') { state.dashboardSelectedMember = null; }
                                else { state.dashboardSelectedMember = { id, name }; }
                                const mainView = document.getElementById('main-view');
                                if (mainView) { mainView.innerHTML = ''; mainView.appendChild(createDashboardView()); }
                            };
                        });
                    };

                    // 이벤트 리스너들
                    if (searchInput) searchInput.onclick = (e) => {
                        e.stopPropagation();
                        dropdownList.classList.toggle('hidden');
                        if (!dropdownList.classList.contains('hidden')) {
                            renderOptions();
                            if (filterInput) { filterInput.value = ''; filterInput.focus(); }
                        }
                    };
                    if (filterInput) filterInput.oninput = (e) => renderOptions(e.target.value);
                    if (filterInput) filterInput.onclick = (e) => e.stopPropagation();
                    if (clearBtn) clearBtn.onclick = (e) => {
                        e.stopPropagation();
                        state.dashboardSelectedMember = null;
                        const mainView = document.getElementById('main-view');
                        if (mainView) { mainView.innerHTML = ''; mainView.appendChild(createDashboardView()); }
                    };

                    document.addEventListener('click', function hideD(e) {
                        const wrapper = div.querySelector('#dashboard-member-dropdown-wrapper');
                        if (wrapper && !wrapper.contains(e.target)) {
                            dropdownList.classList.add('hidden');
                            document.removeEventListener('click', hideD);
                        }
                    });

                    // [핵심] adminSummary 로드 로직
                    if (!state.data.adminSummary) {
                        const adminKey = `DATA_${state.user.staffId}_${state.currentMonth}_admin`;
                        const cachedAdmin = sessionStorage.getItem(adminKey);
                        if (cachedAdmin) {
                            try { state.data.adminSummary = JSON.parse(cachedAdmin); renderOptions(); } catch (e) { }
                        }
                        callApi('getAdminSummary', state.currentMonth, state.user.staffId).then(d => {
                            if (!state.user) return;
                            let parsed = typeof d === 'string' ? JSON.parse(d) : d;
                            if (!parsed.error) {
                                state.data.adminSummary = parsed;
                                sessionStorage.setItem(adminKey, JSON.stringify(parsed));
                                renderOptions(); // 데이터가 오면 목록을 즉시 갱신
                            }
                        });
                    } else {
                        renderOptions();
                    }
                }, 10);
            }

            return div;
        }

        function createBranchView() {
            if (state.isLoading) return getSkeletonUI();
            state.branchSubView = state.branchSubView || 'dashboard';
            state.newContractTab = state.newContractTab || 'nl';

            const div = document.createElement('div');

            if (state.branchSubView === 'newContracts') {
                // === 신계약 리스트 화면 ===
                div.innerHTML = `
                <!-- 제목행 + 대시보드/신계약/로그인기록 탭 버튼 (오른쪽 끝) -->
                <div class="flex flex-col sm:flex-row justify-between mb-4 items-start sm:items-center gap-4">
                    <div>
                        <h2 class="text-xl font-bold text-gray-800 tracking-tight">신계약 리스트 (${state.currentMonth})</h2>
                        <p class="text-gray-500 text-sm mt-1">수수료_DB 기준 신계약 수수료 및 시상금 현황입니다.</p>
                    </div>
                    <div class="flex space-x-1 bg-gray-100 p-1 rounded-xl self-start sm:self-center">
                        <button onclick="setBranchSubView('dashboard')" class="px-4 py-2 text-sm rounded-md transition duration-200 text-gray-500 hover:text-gray-700">대시보드</button>
                        <button onclick="setBranchSubView('newContracts')" class="px-4 py-2 text-sm rounded-md transition duration-200 bg-white shadow-sm text-primary font-bold">신계약 리스트</button>
                        <button onclick="setBranchSubView('loginHistory')" class="px-4 py-2 text-sm rounded-md transition duration-200 text-gray-500 hover:text-gray-700">로그인 기록</button>
                    </div>
                </div>

                <!-- 손보/생보 탭 (border-bottom 스타일) -->
                <div class="mb-4 border-b border-gray-200">
                    <nav class="-mb-px flex space-x-6">
                        <button onclick="setNewContractTab('nl')" class="${state.newContractTab === 'nl' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'} whitespace-nowrap py-3 border-b-2 font-medium text-sm transition">손보 신계약</button>
                        <button onclick="setNewContractTab('l')" class="${state.newContractTab === 'l' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'} whitespace-nowrap py-3 border-b-2 font-medium text-sm transition">생보 신계약</button>
                    </nav>
                </div>

                <!-- 검색창 + 검색 버튼 -->
                <div class="mb-5 flex gap-2 max-w-lg">
                    <div class="relative flex-grow">
                        <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                            <svg class="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd" /></svg>
                        </div>
                        <input type="text" id="ncSearch" value="${state.ncSearch || ''}" placeholder="이름(모집인/계약자) 또는 증권번호 입력 시 즉시 검색" class="w-full pl-11 pr-4 py-3 border border-gray-200 rounded-xl bg-white shadow-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition">
                    </div>
                    <button id="ncSearchBtn" class="px-4 py-2.5 bg-primary hover:bg-primary/90 text-white text-sm font-medium rounded-xl shadow-sm transition whitespace-nowrap">검색</button>
                </div>

                <div id="nc-list-container">
                    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center text-gray-400">
                        <div class="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                        신계약 데이터를 불러오는 중입니다...
                    </div>
                </div>`;

                setTimeout(async () => {
                    const dataKey = state.newContractTab === 'nl' ? 'newContractNl' : 'newContractL';
                    const container = div.querySelector('#nc-list-container');

                    // 1) 계약자-모집인 일치/유사(마스킹 포함) 판별 헬퍼
                    const isSimilarName = (agentName, custName) => {
                        if (!agentName || !custName) return false;
                        const a = String(agentName).replace(/\s+/g, '').replace(/\(.*?\)/g, '');
                        const c = String(custName).replace(/\s+/g, '').replace(/\(.*?\)/g, '');
                        if (!a || !c) return false;
                        if (a === c) return true;

                        // 마스킹(*) 문자가 포함된 경우 (예: 김*민, 김*, 홍**)
                        if (c.includes('*') || a.includes('*')) {
                            // 길이가 같은 경우 (김영민 vs 김*민 등)
                            if (a.length === c.length) {
                                let match = true;
                                let matchedChars = 0;
                                for (let i = 0; i < a.length; i++) {
                                    if (a[i] === '*' || c[i] === '*') continue;
                                    if (a[i] !== c[i]) {
                                        match = false;
                                        break;
                                    }
                                    matchedChars++;
                                }
                                if (match && matchedChars >= 1) return true;
                            }
                            // 정규식 와일드카드 매칭
                            try {
                                if (c.includes('*')) {
                                    const escaped = c.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.');
                                    if (new RegExp('^' + escaped + '$').test(a)) return true;
                                }
                                if (a.includes('*')) {
                                    const escaped = a.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.');
                                    if (new RegExp('^' + escaped + '$').test(c)) return true;
                                }
                            } catch (e) {}
                        }
                        return false;
                    };

                    // 데이터 페치 (캐싱 포함)
                    const fetchData = async () => {
                        if (state.data[dataKey] && state.data[dataKey + '_month'] === state.currentMonth) {
                            return state.data[dataKey];
                        }
                        const res = await callApi('getNewContractList', state.user.staffId, state.currentMonth, state.newContractTab);
                        if (res.error || !res.success) {
                            container.innerHTML = `<div class="p-8 text-center text-red-500 bg-red-50 rounded-2xl border border-red-100">데이터를 불러오지 못했습니다.<br><span class="text-sm">${res.message || ''}</span></div>`;
                            return null;
                        }
                        state.data[dataKey] = res.list || [];
                        state.data[dataKey + '_month'] = state.currentMonth;
                        return state.data[dataKey];
                    };

                    const renderNcTable = (list) => {
                        if (!list || list.length === 0) {
                            container.innerHTML = `<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center text-gray-500">해당 조건의 신계약 데이터가 없습니다.</div>`;
                            return;
                        }
                        const fmtR = (v) => `<span class="${parseFloat(v) < 0 ? 'text-red-500' : 'text-gray-700'}">${v}</span>`;

                        // 2) 모집인별 시각적 구분 및 본인계약 노란색 하이라이트
                        let currentAgentKey = null;
                        let agentGroupIdx = -1;

                        const desktopRows = list.map((r, idx) => {
                            const agentKey = r.agentId || r.name;
                            const isNewAgent = (idx === 0 || agentKey !== currentAgentKey);
                            if (isNewAgent) {
                                currentAgentKey = agentKey;
                                agentGroupIdx++;
                            }

                            const isMatch = isSimilarName(r.name, r.customer);

                            // 모집인 구분 상단 선 (모집인이 바뀔 때 굵은 선으로 구분)
                            const borderClass = (isNewAgent && idx > 0)
                                ? 'border-t-2 border-gray-300'
                                : 'border-b border-gray-100';

                            // 배경색: 일치/유사는 밝은 노란색, 일반 행은 모집인별 교차 배경
                            let rowBgClass = '';
                            if (isMatch) {
                                rowBgClass = 'bg-amber-100/70 hover:bg-amber-200/70';
                            } else if (agentGroupIdx % 2 === 1) {
                                rowBgClass = 'bg-slate-50/70 hover:bg-slate-100/70';
                            } else {
                                rowBgClass = 'bg-white hover:bg-gray-50';
                            }

                            const custCellClass = isMatch 
                                ? 'bg-amber-200/60 font-bold text-amber-900 ring-1 ring-inset ring-amber-300 rounded' 
                                : 'bg-gray-50/60 text-gray-600';
                            const totalCellClass = isMatch ? 'bg-amber-200/40' : 'bg-indigo-50/60';

                            return `
                            <tr class="group transition ${borderClass} ${rowBgClass}">
                                <td class="p-2 text-center text-xs text-gray-500 font-mono">${r.month}</td>
                                <td class="p-2 text-center ${isNewAgent ? 'font-bold text-gray-900' : 'font-semibold text-gray-800'}">${r.name}</td>
                                <td class="p-2 text-center text-xs text-gray-700">${r.company}</td>
                                <td class="p-2 text-left text-xs text-gray-500 font-mono">${r.policyNo}</td>
                                <td class="p-2 text-center text-xs text-gray-500">${r.date}</td>
                                <td class="p-2 text-xs text-gray-700 max-w-[180px]"><div class="truncate" title="${r.product}">${r.product}</div></td>
                                <td class="p-2 text-center text-xs text-gray-500">${r.term}</td>
                                <td class="p-2 text-right text-sm font-medium text-gray-800">${formatMoney(r.premium)}</td>
                                <td class="p-2 text-center text-sm ${custCellClass}">${r.customer}</td>
                                <td class="p-2 text-right text-sm font-bold ${r.commission < 0 ? 'text-red-500' : 'text-blue-600'}">${formatMoney(r.commission)}</td>
                                <td class="p-2 text-right text-xs">${fmtR(r.commRate)}</td>
                                <td class="p-2 text-right text-sm font-bold ${r.reward < 0 ? 'text-red-500' : 'text-blue-600'} ${r.rewardDesc ? 'custom-tooltip text-blue-800/90' : ''}" ${r.rewardDesc ? `data-tooltip="${r.rewardDesc}" tabindex="0"` : ''}>${formatMoney(r.reward)}</td>
                                <td class="p-2 text-right text-xs">${fmtR(r.rewardRate)}</td>
                                <td class="p-2 text-right text-sm font-extrabold ${r.total < 0 ? 'text-red-500' : 'text-gray-900'} ${totalCellClass}">${formatMoney(r.total)}</td>
                                <td class="p-2 text-right text-xs font-semibold ${totalCellClass}">${fmtR(r.totalRate)}</td>
                            </tr>`;
                        }).join('');

                        let currentMobileAgentKey = null;
                        const mobileCards = list.map((r, idx) => {
                            const agentKey = r.agentId || r.name;
                            const isNewAgent = (idx === 0 || agentKey !== currentMobileAgentKey);
                            if (isNewAgent) {
                                currentMobileAgentKey = agentKey;
                            }

                            const isMatch = isSimilarName(r.name, r.customer);
                            const cardBg = isMatch 
                                ? 'bg-amber-50/90 border-amber-300 ring-1 ring-amber-300 shadow-sm' 
                                : 'bg-white border-gray-100 shadow-sm';

                            const agentHeader = isNewAgent ? `
                            <div class="${idx > 0 ? 'mt-4' : ''} pt-2 pb-1.5 px-1 flex items-center justify-between border-b border-gray-200">
                                <div class="flex items-center gap-2">
                                    <span class="w-2.5 h-2.5 rounded-full bg-primary"></span>
                                    <span class="font-bold text-sm text-gray-900">${r.name}</span>
                                    <span class="text-xs text-gray-500 font-mono">(${r.agentId || '모집인'})</span>
                                </div>
                            </div>` : '';

                            return `
                            ${agentHeader}
                            <div class="${cardBg} rounded-2xl p-4">
                                <div class="flex justify-between items-start mb-2">
                                    <div>
                                        <p class="font-bold text-gray-900">${r.name} <span class="text-xs text-gray-400 font-normal">(${r.company})</span></p>
                                        <p class="text-xs text-gray-500 font-mono mt-0.5">${r.policyNo}</p>
                                    </div>
                                    <div class="text-right">
                                        <p class="text-xs text-gray-400">익월총수당</p>
                                        <p class="font-extrabold text-base ${r.total < 0 ? 'text-red-500' : 'text-gray-900'}">${formatMoney(r.total)}</p>
                                    </div>
                                </div>
                                <p class="text-sm text-gray-600 mb-3 truncate">${r.product}</p>
                                <div class="grid grid-cols-3 gap-2 text-center text-xs bg-gray-50/80 rounded-xl p-2">
                                    <div><p class="text-gray-400 mb-0.5">보험료</p><p class="font-semibold text-gray-700">${formatMoney(r.premium)}</p></div>
                                    <div><p class="text-gray-400 mb-0.5">익월수수료</p><p class="font-semibold ${r.commission < 0 ? 'text-red-500' : 'text-blue-600'}">${formatMoney(r.commission)}</p></div>
                                    <div><p class="text-gray-400 mb-0.5">시상금계</p><p class="font-semibold ${r.reward < 0 ? 'text-red-500' : 'text-blue-600'} ${r.rewardDesc ? 'custom-tooltip text-blue-800/90' : ''}" ${r.rewardDesc ? `data-tooltip="${r.rewardDesc}" tabindex="0"` : ''}>${formatMoney(r.reward)}</p></div>
                                </div>
                                <div class="mt-2 flex justify-between items-center text-[11px] text-gray-500">
                                    <div>계약자: <span class="${isMatch ? 'px-1.5 py-0.5 bg-amber-200 text-amber-900 font-bold rounded' : 'font-medium'}">${r.customer}</span></div>
                                    <div>총수당율: <span class="font-semibold">${r.totalRate}</span></div>
                                </div>
                            </div>`;
                        }).join('');

                        container.innerHTML = `
                        <div class="flex justify-end mb-2 px-1 text-sm text-gray-600">
                            조회결과 : <span class="font-bold text-gray-800 ml-1">${list.length}</span>건
                        </div>
                        <!-- 데스크탑 테이블 -->
                        <div class="hidden md:block bg-white shadow-sm border border-gray-200 rounded-xl overflow-hidden mb-4">
                            <div class="overflow-x-auto">
                            <table class="min-w-full divide-y divide-gray-200 whitespace-nowrap text-sm">
                                <thead class="bg-gray-50">
                                    <tr class="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                        <th class="px-2 py-3 text-center">마감월</th>
                                        <th class="px-2 py-3 text-center">이름</th>
                                        <th class="px-2 py-3 text-center">보험사</th>
                                        <th class="px-2 py-3 text-left">증권번호</th>
                                        <th class="px-2 py-3 text-center">계약일</th>
                                        <th class="px-2 py-3 text-center">상품명</th>
                                        <th class="px-2 py-3 text-center">납기</th>
                                        <th class="px-2 py-3 text-right">보험료</th>
                                        <th class="px-2 py-3 text-center bg-gray-100/60">계약자</th>
                                        <th class="px-2 py-3 text-right">익월수수료</th>
                                        <th class="px-2 py-3 text-right">수수료율</th>
                                        <th class="px-2 py-3 text-right">시상금계</th>
                                        <th class="px-2 py-3 text-right">시상률</th>
                                        <th class="px-2 py-3 text-right bg-indigo-50/60">익월총수당</th>
                                        <th class="px-2 py-3 text-right bg-indigo-50/60">총수당율</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-gray-100 bg-white">${desktopRows}</tbody>
                            </table>
                            </div>
                        </div>
                        <!-- 모바일 카드 -->
                        <div class="md:hidden flex flex-col gap-3">${mobileCards}</div>`;
                    };

                    // 3) 실시간 검색 핸들러 (입력 즉시 필터링)
                    let cachedList = null;

                    const doSearch = (filterText) => {
                        if (!cachedList) return;
                        const q = (filterText || '').trim().toLowerCase();
                        if (!q) {
                            renderNcTable(cachedList);
                        } else {
                            const filtered = cachedList.filter(r => 
                                (r.name && r.name.toLowerCase().includes(q)) || 
                                (r.customer && r.customer.toLowerCase().includes(q)) || 
                                (r.policyNo && r.policyNo.toLowerCase().includes(q)) ||
                                (r.company && r.company.toLowerCase().includes(q))
                            );
                            renderNcTable(filtered);
                        }
                    };

                    const searchInput = div.querySelector('#ncSearch');
                    const searchBtn = div.querySelector('#ncSearchBtn');

                    if (searchInput) {
                        // 실시간 입력 이벤트: 타이핑 즉시 검색 결과 표시
                        searchInput.addEventListener('input', (e) => {
                            state.ncSearch = e.target.value;
                            doSearch(state.ncSearch);
                        });
                        searchInput.addEventListener('keydown', (e) => {
                            if (e.key === 'Enter') {
                                state.ncSearch = e.target.value;
                                doSearch(state.ncSearch);
                            }
                        });
                    }
                    if (searchBtn) {
                        searchBtn.addEventListener('click', () => {
                            doSearch(state.ncSearch);
                        });
                    }

                    // 초기 데이터 로드 및 렌더링
                    cachedList = await fetchData();
                    if (cachedList) {
                        doSearch(state.ncSearch || '');
                    }
                }, 10);

                return div;
            }

            // === 로그인 기록 화면 ===
            if (state.branchSubView === 'loginHistory') {
                // 날짜 계산 유틸
                const todayD = new Date();
                // 볼지 포맷터: 로켈 날짜 기준 (toISOString 사용시 UTC 오프셋으로 1일 밀롬 발생)
                const fmtDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                const getMonthRange = (offset) => {
                    const y = todayD.getFullYear(), m = todayD.getMonth() + offset;
                    const start = new Date(y, m, 1);
                    const end = new Date(y, m + 1, 0);
                    return { start: fmtDate(start), end: fmtDate(end) };
                };
                const getLast30Range = () => {
                    const end = new Date(todayD);
                    const start = new Date(todayD);
                    start.setDate(start.getDate() - 29);
                    return { start: fmtDate(start), end: fmtDate(end) };
                };

                const defaultRange = getLast30Range(); // 디폴트: 최근 30일

                div.innerHTML = `
                <!-- 제목행 + 탭 버튼 -->
                <div class="flex flex-col sm:flex-row justify-between mb-6 items-start sm:items-center gap-4">
                    <div>
                        <h2 class="text-xl font-bold text-gray-800 tracking-tight">로그인 기록</h2>
                        <p class="text-gray-500 text-sm mt-1">Board 시트 기준 사용자 로그인 활동 현황입니다.</p>
                    </div>
                    <div class="flex space-x-1 bg-gray-100 p-1 rounded-xl self-start sm:self-center">
                        <button onclick="setBranchSubView('dashboard')" class="px-4 py-2 text-sm rounded-md transition duration-200 text-gray-500 hover:text-gray-700">대시보드</button>
                        <button onclick="setBranchSubView('newContracts')" class="px-4 py-2 text-sm rounded-md transition duration-200 text-gray-500 hover:text-gray-700">신계약 리스트</button>
                        <button onclick="setBranchSubView('loginHistory')" class="px-4 py-2 text-sm rounded-md transition duration-200 bg-white shadow-sm text-primary font-bold">로그인 기록</button>
                    </div>
                </div>

                <!-- 날짜 필터 UI -->
                <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-6">
                    <div class="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
                        <!-- 빠른 기간 선택 콤보박스 -->
                        <div class="flex flex-col gap-1 min-w-[110px]">
                            <label class="text-xs font-bold text-gray-500">빠른 선택</label>
                            <select id="lh-quick-select" class="appearance-none bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 font-medium cursor-pointer focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition">
                                <option value="last30" selected>최근 30일</option>
                                <option value="0">당월</option>
                                <option value="-1">전월</option>
                                <option value="-2">전전월</option>
                            </select>
                        </div>
                        <!-- 시작일 -->
                        <div class="flex flex-col gap-1">
                            <label class="text-xs font-bold text-gray-500">시작일</label>
                            <input type="date" id="lh-start" value="${defaultRange.start}" class="border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-gray-50 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition">
                        </div>
                        <!-- 종료일 -->
                        <div class="flex flex-col gap-1">
                            <label class="text-xs font-bold text-gray-500">종료일</label>
                            <input type="date" id="lh-end" value="${defaultRange.end}" class="border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-gray-50 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition">
                        </div>
                        <!-- 조회 버튼 -->
                        <button id="lh-fetch-btn" class="px-5 py-2.5 bg-primary hover:bg-primaryHover text-white text-sm font-bold rounded-xl shadow-sm transition whitespace-nowrap self-end">
                            조회
                        </button>
                    </div>
                </div>

                <!-- 결과 영역 -->
                <div id="lh-result">
                    <div class="flex items-center justify-center h-40">
                        <div class="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                    </div>
                </div>`;

                setTimeout(async () => {
                    const resultEl = div.querySelector('#lh-result');
                    const startInput = div.querySelector('#lh-start');
                    const endInput = div.querySelector('#lh-end');
                    const quickSel = div.querySelector('#lh-quick-select');
                    const fetchBtn = div.querySelector('#lh-fetch-btn');

                    const todayLocal = new Date();
                    // 로켈 날짜 기준 포맷터 (한국 시간대 UTC+9 오프셋 문제 해결)
                    const fmtLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    const getMRange = (offset) => {
                        const y = todayLocal.getFullYear(), m = todayLocal.getMonth() + offset;
                        const s = new Date(y, m, 1);
                        const e = new Date(y, m + 1, 0);
                        return { start: fmtLocal(s), end: fmtLocal(e) };
                    };
                    const getLast30 = () => {
                        const e = new Date(todayLocal);
                        const s = new Date(todayLocal);
                        s.setDate(s.getDate() - 29);
                        return { start: fmtLocal(s), end: fmtLocal(e) };
                    };

                    // 빠른 선택 콤보박스 변경 시 날짜 입력란 자동 갱신
                    if (quickSel) {
                        quickSel.addEventListener('change', () => {
                            const v = quickSel.value;
                            const range = v === 'last30' ? getLast30() : getMRange(parseInt(v));
                            if (startInput) startInput.value = range.start;
                            if (endInput) endInput.value = range.end;
                        });
                    }

                    const renderLoginHistory = (list) => {
                        if (!list || list.length === 0) {
                            resultEl.innerHTML = `<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center text-gray-500">해당 기간의 로그인 기록이 없습니다.</div>`;
                            return;
                        }

                        // 로그인 일시 기준 내림차순 정렬 (문자열 날짜 파싱 보완)
                        list.sort((a, b) => {
                            const parseDate = (str) => {
                                if (!str) return 0;
                                if (str.includes('-')) {
                                    const d = new Date(str.replace(' ', 'T'));
                                    if (!isNaN(d.getTime())) return d.getTime();
                                }
                                let m = str.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(오전|오후)?\s*(\d{1,2}):(\d{1,2})/);
                                if (m) {
                                    let h = parseInt(m[5]);
                                    if (m[4] === '오후' && h !== 12) h += 12;
                                    if (m[4] === '오전' && h === 12) h = 0;
                                    return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]), h, parseInt(m[6])).getTime();
                                }
                                const fallback = new Date(str);
                                return isNaN(fallback.getTime()) ? 0 : fallback.getTime();
                            };
                            return parseDate(b.datetime) - parseDate(a.datetime);
                        });

                        // 1. 집계
                        const totalCount = list.length;
                        const userMap = {};
                        const userNameMap = {};
                        list.forEach(r => {
                            userMap[r.staffId] = (userMap[r.staffId] || 0) + 1;
                            if (!userNameMap[r.staffId]) userNameMap[r.staffId] = r.name;
                        });
                        const uniqueUsers = Object.keys(userMap).length;
                        const topUser = Object.entries(userMap).sort((a, b) => b[1] - a[1])[0];
                        const topUserName = topUser ? (userNameMap[topUser[0]] || topUser[0]) : '-';
                        const topUserCount = topUser ? topUser[1] : 0;

                        // 2. 시간대별 분포 (0~23시)
                        const hourDist = Array(24).fill(0);
                        list.forEach(r => { if (r.hour >= 0 && r.hour < 24) hourDist[r.hour]++; });
                        const maxHour = Math.max(...hourDist, 1);

                        const barChart = Array.from({ length: 24 }, (_, h) => {
                            const cnt = hourDist[h];
                            const pct = Math.round((cnt / maxHour) * 100);
                            const isWork = h >= 8 && h <= 19;
                            const barColor = isWork ? 'bg-primary' : 'bg-gray-300';
                            return `<div class="flex flex-col items-center gap-0.5" style="width: calc(100%/24)">
                                <span class="text-[9px] text-gray-500 font-medium">${cnt > 0 ? cnt : ''}</span>
                                <div class="w-full flex flex-col justify-end" style="height:60px">
                                    <div class="${barColor} rounded-t-sm transition-all duration-300" style="height:${pct}%"></div>
                                </div>
                                <span class="text-[9px] text-gray-400">${h}</span>
                            </div>`;
                        }).join('');

                        // 3. 최근 30일 로그인 추이 (오늘 기준 30일)
                        const todayForChart = new Date();
                        const last30Days = Array.from({ length: 30 }, (_, i) => {
                            const d = new Date(todayForChart);
                            d.setDate(d.getDate() - (29 - i));
                            return d.toISOString().slice(0, 10);
                        });
                        const dateMap30 = {};
                        list.forEach(r => { if (r.date) dateMap30[r.date] = (dateMap30[r.date] || 0) + 1; });
                        const counts30 = last30Days.map(d => dateMap30[d] || 0);
                        const max30 = Math.max(...counts30, 1);

                        const trend30Bars = last30Days.map((date, i) => {
                            const cnt = counts30[i];
                            const pct = Math.round((cnt / max30) * 100);
                            const shortDate = date.slice(5).replace('-', '-'); // MM-DD
                            return `<div class="flex flex-col items-center gap-0.5" style="min-width:0; flex:1">
                                <span class="text-[9px] font-medium" style="color:${cnt > 0 ? '#F37321' : 'transparent'}">${cnt > 0 ? cnt : '0'}</span>
                                <div class="w-full flex flex-col justify-end" style="height:70px">
                                    <div class="w-full rounded-t-sm transition-all duration-500" style="height:${Math.max(pct, cnt > 0 ? 3 : 0)}%; background: linear-gradient(to top, #F37321, #f59a5a)"></div>
                                </div>
                                <span class="text-[8px] text-gray-400 truncate w-full text-center">${shortDate}</span>
                            </div>`;
                        }).join('');

                        // 4. 조회 기간의 로그인 사용자 테이블
                        const userEntries = Object.entries(userMap)
                            .sort((a, b) => b[1] - a[1]);
                        const userRows = userEntries.map(([sid, cnt]) => `
                        <tr class="border-b border-gray-100 hover:bg-gray-50 transition">
                            <td class="p-3 text-xs text-gray-500 font-mono">${sid}</td>
                            <td class="p-3 font-semibold text-gray-800 text-center">${userNameMap[sid] || '-'}</td>
                            <td class="p-3 text-center font-bold text-primary">${cnt}회</td>
                        </tr>`).join('');

                        // 5. 상세 테이블 ('디바이스' 열 제거)
                        const rows = list.map(r => `
                        <tr class="border-b border-gray-100 hover:bg-gray-50 transition">
                            <td class="p-3 text-xs text-gray-500 font-mono whitespace-nowrap">${r.datetime}</td>
                            <td class="p-3 font-semibold text-gray-800 text-center">${r.name}</td>
                            <td class="p-3 text-sm text-gray-500 text-center font-mono">${r.staffId}</td>
                        </tr>`).join('');

                        // 모바일 카드
                        const mobileCards = list.slice(0, 50).map(r => `
                        <div class="bg-white rounded-xl border border-gray-100 p-3.5 flex justify-between items-center shadow-sm">
                            <div>
                                <p class="font-bold text-gray-800">${r.name} <span class="text-xs text-gray-400 font-normal ml-1">${r.staffId}</span></p>
                                <p class="text-xs text-gray-400 mt-0.5 font-mono">${r.datetime}</p>
                            </div>
                        </div>`).join('');

                        resultEl.innerHTML = `
                        <!-- 요약 카드 3개 -->
                        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                            <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col items-center text-center border-l-[5px] border-l-primary">
                                <p class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">조회 기간내 총 로그인</p>
                                <p class="text-3xl font-extrabold text-gray-800">${totalCount}<span class="text-lg ml-1 font-semibold text-gray-400">회</span></p>
                            </div>
                            <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col items-center text-center border-l-[5px] border-l-blue-500">
                                <p class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">조회 기간내 활성 사용자</p>
                                <p class="text-3xl font-extrabold text-gray-800">${uniqueUsers}<span class="text-lg ml-1 font-semibold text-gray-400">명</span></p>
                            </div>
                            <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col items-center text-center border-l-[5px] border-l-orange-400">
                                <p class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">최다 로그인 사용자</p>
                                <p class="text-xl font-extrabold text-gray-800">${topUserName}</p>
                                <p class="text-sm text-gray-400 mt-1">${topUserCount}회 로그인</p>
                            </div>
                        </div>

                        <!-- 시간대별 분포 차트 -->
                        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-6">
                            <div class="flex items-center gap-2 mb-4">
                                <span class="w-1.5 h-5 bg-primary rounded-full"></span>
                                <h3 class="font-bold text-gray-800">시간대별 로그인 분포</h3>
                                <span class="text-xs text-gray-400 ml-auto">주황색: 업무시간(08~19시)</span>
                            </div>
                            <div class="flex items-end gap-0.5 w-full">${barChart}</div>
                        </div>

                        <!-- 최근 30일 로그인 추이 -->
                        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-6">
                            <div class="flex items-center gap-2 mb-4">
                                <h3 class="font-bold text-gray-800">최근 30일 로그인 추이</h3>
                            </div>
                            <div class="flex items-end gap-0.5 w-full overflow-hidden">${trend30Bars}</div>
                        </div>

                        <!-- 하단: 사용자 테이블 + 상세 테이블 나란히 -->
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <!-- 조회 기간의 로그인 사용자 -->
                            <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                                <div class="px-5 py-4 border-b border-gray-100 bg-gray-50/50">
                                    <h3 class="font-bold text-gray-800 flex items-center gap-2">
                                        <svg class="w-4 h-4 text-primary" fill="currentColor" viewBox="0 0 24 24"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>
                                        조회 기간의 로그인 사용자 <span class="text-xs font-normal text-gray-400 ml-1">(${uniqueUsers}명)</span>
                                    </h3>
                                </div>
                                <div class="overflow-x-auto">
                                    <table class="w-full text-sm">
                                        <thead class="bg-gray-50 border-b border-gray-100">
                                            <tr class="text-left text-gray-500">
                                                <th class="p-3 font-semibold">사번</th>
                                                <th class="p-3 font-semibold text-center">이름</th>
                                                <th class="p-3 font-semibold text-center">로그인 횟수</th>
                                            </tr>
                                        </thead>
                                        <tbody>${userRows}</tbody>
                                    </table>
                                </div>
                            </div>

                            <!-- 로그인 상세 내역 -->
                            <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                                <div class="px-5 py-4 border-b border-gray-100 bg-gray-50/50">
                                    <h3 class="font-bold text-gray-800 flex items-center gap-2">
                                        <span class="w-1.5 h-5 bg-gray-400 rounded-full block"></span>
                                        로그인 상세 내역 <span class="text-xs font-normal text-gray-400 ml-1">(총 <span class="text-primary font-bold">${totalCount}</span>건)</span>
                                    </h3>
                                </div>
                                <div class="hidden md:block overflow-x-auto" style="max-height:1000px; overflow-y:auto">
                                    <table class="w-full text-sm">
                                        <thead class="bg-gray-50 border-b border-gray-100 sticky top-0">
                                            <tr class="text-left text-gray-500">
                                                <th class="p-3 font-semibold">로그인 일시</th>
                                                <th class="p-3 font-semibold text-center">이름</th>
                                                <th class="p-3 font-semibold text-center">사번</th>
                                            </tr>
                                        </thead>
                                        <tbody>${rows}</tbody>
                                    </table>
                                </div>
                                <div class="md:hidden flex flex-col gap-2 p-3">${mobileCards}${list.length > 50 ? `<p class="text-xs text-center text-gray-400 mt-2">모바일에서는 최근 50건만 표시됩니다.</p>` : ''}</div>
                            </div>
                        </div>`;
                    };

                    const loadData = async () => {
                        const start = startInput?.value || '';
                        const end = endInput?.value || '';
                        resultEl.innerHTML = `<div class="flex items-center justify-center h-40"><div class="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div></div>`;
                        const res = await callApi('getLoginHistory', start, end, state.user.staffId);
                        if (res.error) {
                            resultEl.innerHTML = `<div class="p-8 text-center text-red-500 bg-red-50 rounded-2xl">${res.message}</div>`;
                            return;
                        }
                        renderLoginHistory(res.list || []);
                    };

                    if (fetchBtn) fetchBtn.addEventListener('click', loadData);

                    // 초기 데이터 로드
                    loadData();
                }, 10);

                return div;
            }

            // === 대시보드 화면 (default) ===

            // 시상금 데이터 (손보 법인, 생보 법인, 2차년 인센티브, 해촉자 정산)
            const d = state.data.rewardData?.summary || {};
            const rewardKeys = ['손보 법인시상금', '생보 법인시상금', '2차년 인센티브', '해촉자 정산'];
            let rewardPay = 0, rewardRefund = 0;
            rewardKeys.forEach(k => { const o = d[k] || { pay: 0, refund: 0 }; rewardPay += o.pay; rewardRefund += o.refund; });
            const rewardNet = rewardPay + rewardRefund;

            // 수수료 데이터
            const c = state.data.branchCommData || {};
            const commLoaded = !!state.data.branchCommData;
            const nonLifePay = c.nonLifePay || 0;
            const nonLifeRefund = c.nonLifeRefund || 0;
            const lifePay = c.lifePay || 0;
            const lifeRefund = c.lifeRefund || 0;

            // 기타 수수료 및 세후지급공제 데이터
            const otherCommPay = c.otherCommPay || 0;
            const otherCommRefund = c.otherCommRefund || 0;
            const afterTaxPay = c.afterTaxPay || 0;
            const afterTaxRefund = c.afterTaxRefund || 0;

            // 기타 입금 / 상위 차감 (수수료 항목에 합산)
            const etcPay = otherCommPay + afterTaxPay;
            const etcRefund = otherCommRefund + afterTaxRefund;

            // 수수료 총합 (손보 + 생보 + 기타 입금 / 상위 차감)
            const commTotalPay = nonLifePay + lifePay + etcPay;
            const commTotalRefund = nonLifeRefund + lifeRefund + etcRefund;
            const commNet = commTotalPay + commTotalRefund;

            // 전체 합산 (수수료 + 시상금)
            const grandNet = commNet + rewardNet;

            // 스피너 HTML
            const spinner = `<svg class="animate-spin w-5 h-5 text-gray-300 inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;

            // 완전한 상단 3개 요약카드 (큰 복합 카드) / smallFont=true 이면 숫자 한 단계 작게
            const summaryCard = (title, totalAmt, sub1Label, sub1Amt, sub2Label, sub2Amt, accentColor, loaded, smallFont = false) => `
                <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col h-full">
                    <div class="relative mb-3 text-center">
                        <span class="absolute right-0 top-0 w-2 h-8 ${accentColor} rounded-full"></span>
                        <p class="text-xs font-bold text-gray-400 uppercase tracking-wider">${title}</p>
                        <p class="${smallFont ? 'text-xl' : 'text-2xl'} font-extrabold mt-1 ${Number(totalAmt) < 0 ? 'text-red-500' : 'text-gray-800'} tracking-tight">
                            ${loaded ? formatMoney(totalAmt) : spinner}
                        </p>
                    </div>
                    <div class="mt-auto pt-3 border-t border-gray-50 grid grid-cols-2 gap-2 text-center">
                        <div>
                            <p class="text-[10px] text-gray-400 font-semibold mb-0.5">${sub1Label}</p>
                            <p class="text-base font-bold ${Number(sub1Amt) < 0 ? 'text-red-500' : 'text-gray-700'}">${loaded ? formatMoney(sub1Amt) : spinner}</p>
                        </div>
                        <div>
                            <p class="text-[10px] text-gray-400 font-semibold mb-0.5">${sub2Label}</p>
                            <p class="text-base font-bold ${Number(sub2Amt) < 0 ? 'text-red-500' : 'text-gray-700'}">${loaded ? formatMoney(sub2Amt) : spinner}</p>
                        </div>
                    </div>
                </div>`;

            // 수수료 상세 카드 (지급/환수)
            const commDetailCard = (title, pay, refund, loaded, subNotice = '', payLabel = '지급', refundLabel = '환수') => {
                const net = pay + refund;
                return `<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col h-full">
                    <div class="flex justify-between mb-3 border-b border-gray-50 pb-3 items-center">
                        <div>
                            <h3 class="font-bold text-base text-gray-800 flex items-center gap-2">
                                <div class="w-1.5 h-1.5 rounded-full bg-primary/50"></div>${title}
                            </h3>
                            ${subNotice ? `<p class="text-[10px] text-gray-400 mt-0.5">${subNotice}</p>` : ''}
                        </div>
                        <span class="text-base font-bold ${net < 0 ? 'text-red-600' : 'text-gray-800'}">${loaded ? formatMoney(net) : spinner}</span>
                    </div>
                    <div class="grid grid-cols-2 gap-3 text-center mt-auto">
                        <div class="p-2.5 bg-blue-50/50 rounded-xl border border-blue-100/50">
                            <p class="text-[10px] text-gray-400 font-bold uppercase mb-1">${payLabel}</p>
                            <p class="text-base font-bold text-blue-600">${loaded ? formatMoney(pay) : spinner}</p>
                        </div>
                        <div class="p-2.5 bg-red-50/50 rounded-xl border border-red-100/50">
                            <p class="text-[10px] text-gray-400 font-bold uppercase mb-1">${refundLabel}</p>
                            <p class="text-base font-bold text-red-500">${loaded ? formatMoney(refund) : spinner}</p>
                        </div>
                    </div>
                </div>`;
            };

            // 밝고 화사한 시상금 상세 카드 (손보법인, 생보법인, 2차년인센티브, 해촉자정산)
            const rewardDetailCard = (title, key) => {
                const obj = d[key] || { pay: 0, refund: 0 };
                const subTotal = obj.pay + obj.refund;
                return `<div class="bg-gradient-to-br from-amber-50/80 via-orange-50/40 to-yellow-50/60 rounded-2xl shadow-sm border border-amber-200/70 p-5 flex flex-col h-full hover:shadow-md transition">
                    <div class="flex justify-between mb-4 border-b border-amber-200/50 pb-3 items-center">
                        <h3 class="font-bold text-base text-amber-950 flex items-center gap-2">
                            <div class="w-2 h-2 rounded-full bg-amber-500 shadow-sm"></div>${title}
                        </h3>
                        <span class="text-base font-extrabold ${subTotal < 0 ? 'text-red-600' : 'text-amber-900'}">${formatMoney(subTotal)}</span>
                    </div>
                    <div class="grid grid-cols-2 gap-3 text-center mt-auto">
                        <div class="cursor-pointer bg-white/90 hover:bg-blue-50/90 p-2.5 rounded-xl transition border border-amber-100 hover:border-blue-200 shadow-xs group" onclick="openDetail('${key}','pay')">
                            <p class="text-[10px] text-gray-400 font-bold uppercase mb-1">지급</p>
                            <p class="text-base font-bold text-blue-600 group-hover:scale-105 transition-transform">${formatMoney(obj.pay)}</p>
                        </div>
                        <div class="cursor-pointer bg-white/90 hover:bg-red-50/90 p-2.5 rounded-xl transition border border-amber-100 hover:border-red-200 shadow-xs group" onclick="openDetail('${key}','refund')">
                            <p class="text-[10px] text-gray-400 font-bold uppercase mb-1">환수</p>
                            <p class="text-base font-bold text-red-500 group-hover:scale-105 transition-transform">${formatMoney(obj.refund)}</p>
                        </div>
                    </div>
                </div>`;
            };

            // 기타 수수료/공제 상세 카드 (참고용)
            const branchEtcDetailCard = (title, pay, refund, loaded, cardType) => {
                const subTotal = pay + refund;
                return `<div class="bg-gray-50/80 rounded-2xl shadow-sm border border-gray-200/70 p-5 flex flex-col h-full">
                    <div class="flex justify-between mb-4 border-b border-gray-200/50 pb-3 items-center">
                        <h3 class="font-bold text-base text-gray-700 flex items-center gap-2">
                            <div class="w-1.5 h-1.5 rounded-full bg-gray-400"></div>${title}
                        </h3>
                        <span class="text-base font-bold ${subTotal < 0 ? 'text-red-600' : 'text-gray-800'}">${loaded ? formatMoney(subTotal) : spinner}</span>
                    </div>
                    <div class="grid grid-cols-2 gap-3 text-center mt-auto">
                        <div class="cursor-pointer bg-white hover:bg-blue-50/50 p-2.5 rounded-xl transition border border-gray-100 hover:border-blue-100 shadow-xs group" onclick="openBranchEtcDetail('${cardType}','pay')">
                            <p class="text-[10px] text-gray-400 font-bold uppercase mb-1">지급</p>
                            <p class="text-base font-bold text-blue-600 group-hover:scale-105 transition-transform">${loaded ? formatMoney(pay) : spinner}</p>
                        </div>
                        <div class="cursor-pointer bg-white hover:bg-red-50/50 p-2.5 rounded-xl transition border border-gray-100 hover:border-red-100 shadow-xs group" onclick="openBranchEtcDetail('${cardType}','refund')">
                            <p class="text-[10px] text-gray-400 font-bold uppercase mb-1">환수</p>
                            <p class="text-base font-bold text-red-500 group-hover:scale-105 transition-transform">${loaded ? formatMoney(refund) : spinner}</p>
                        </div>
                    </div>
                </div>`;
            };

            div.innerHTML = `
            <div class="flex flex-col sm:flex-row justify-between mb-6 items-start sm:items-center gap-4">
                <div>
                    <div class="flex flex-wrap items-center gap-2.5">
                        <h2 class="text-xl font-bold text-gray-800">지사의 수수료와 시상금 (${state.currentMonth})</h2>
                        <!-- 마감 상태 뱃지 및 마감하기/취소 버튼 -->
                        <div id="branchMonthClosingArea" class="flex items-center gap-2">
                            <span id="branchMonthClosingBadge" class="text-xs px-2.5 py-1 rounded-full font-medium bg-gray-100 text-gray-400 border border-gray-200 animate-pulse">마감상태 확인중...</span>
                            <button id="branchMonthClosingBtn" onclick="handleToggleMonthClosing()" class="hidden text-xs px-3 py-1 rounded-lg font-bold transition shadow-xs"></button>
                        </div>
                    </div>
                    <p class="text-sm text-gray-500 mt-1">지사 수수료 및 법인 시상 현황입니다.</p>
                </div>
                <div class="flex space-x-1 bg-gray-100 p-1 rounded-xl self-start sm:self-center">
                    <button onclick="setBranchSubView('dashboard')" class="px-4 py-2 text-sm rounded-md transition duration-200 bg-white shadow-sm text-primary font-bold">대시보드</button>
                    <button onclick="setBranchSubView('newContracts')" class="px-4 py-2 text-sm rounded-md transition duration-200 text-gray-500 hover:text-gray-700">신계약 리스트</button>
                    <button onclick="setBranchSubView('loginHistory')" class="px-4 py-2 text-sm rounded-md transition duration-200 text-gray-500 hover:text-gray-700">로그인 기록</button>
                </div>
            </div>

            <!-- 당월 마감 AI 종합 브리핑 위젯 영역 -->
            <div id="branch-ai-briefing-container"></div>

            <!-- 행1: 요약 카드 3개 -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div class="col-span-1">
                    ${summaryCard(
                '실지급 총액 (수수료 + 시상금)',
                grandNet,
                '수수료', commNet,
                '시상금', rewardNet,
                'bg-primary',
                commLoaded
            )}
                </div>
                <div class="col-span-1">
                    ${summaryCard(
                '총 지급액 (수수료, 시상금)',
                commTotalPay + rewardPay,
                '수수료 지급', commTotalPay,
                '시상금 지급', rewardPay,
                'bg-blue-500',
                commLoaded,
                true
            )}
                </div>
                <div class="col-span-1">
                    ${summaryCard(
                '총 환수액 (수수료, 시상금)',
                commTotalRefund + rewardRefund,
                '수수료 환수', commTotalRefund,
                '시상금 환수', rewardRefund,
                'bg-red-400',
                commLoaded,
                true
            )}
                </div>
            </div>

            <!-- 행2: 수수료 상세 카드 3개 (손보 수수료, 생보 수수료, 기타 입금 / 상위 차감) -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div>${commDetailCard('손보 수수료', nonLifePay, nonLifeRefund, commLoaded)}</div>
                <div>${commDetailCard('생보 수수료', lifePay, lifeRefund, commLoaded)}</div>
                <div>${commDetailCard('기타 입금 / 상위 차감', etcPay, etcRefund, commLoaded, "※ '기타 수수료 (세전)'와 '기타 지급 및 공제 (세후)'의 합산", '기타 입금', '상위 차감')}</div>
            </div>

            <!-- 행3: 시상금 카드 3개 (손보 법인, 생보 법인, 2차년 인센티브) -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                ${rewardDetailCard('손보 법인', '손보 법인시상금')}
                ${rewardDetailCard('생보 법인', '생보 법인시상금')}
                ${rewardDetailCard('2차년 인센티브', '2차년 인센티브')}
            </div>

            <!-- 행4: 해촉자 정산(시상금) 및 참고용 기타 수수료/공제 카드 -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                ${rewardDetailCard('해촉자 정산', '해촉자 정산')}
                ${branchEtcDetailCard('※ 기타 수수료 (세전)', otherCommPay, otherCommRefund, commLoaded, 'otherComm')}
                ${branchEtcDetailCard('※ 기타 지급 및 공제 (세후)', afterTaxPay, afterTaxRefund, commLoaded, 'afterTax')}
            </div>

            <div class="text-center">
                <div class="inline-block px-4 py-2 bg-gray-100 rounded-xl md:rounded-full text-sm text-gray-500 font-medium select-none text-center">
                    💡 Tip: 시상금 및 기타 수수료/공제 항목의 지급/환수 금액을 클릭하면<br class="md:hidden"> 상세 내역을 볼 수 있습니다.
                </div>
            </div>`;

            // 마감 상태 비동기 조회 및 AI 브리핑 위젯 로드
            setTimeout(() => {
                checkMonthClosingStatus();
                const aiCont = div.querySelector('#branch-ai-briefing-container');
                if (aiCont) renderAIBriefingWidget(aiCont, 'branch');
            }, 20);

            return div;
        }

        // ==========================================
        // ?쒕룞愿由?View
        // ==========================================
        // ==========================================
        // 활동관리 View
        // ==========================================
        function getISOWeekJS(date) {
            const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
            const dayNum = d.getUTCDay() || 7;
            d.setUTCDate(d.getUTCDate() + 4 - dayNum);
            const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
            const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
            return { year: d.getUTCFullYear(), week: week };
        }
        function getMonday(year, week) {
            const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
            const dayOfWeek = simple.getUTCDay();
            if (dayOfWeek <= 4) simple.setUTCDate(simple.getUTCDate() - dayOfWeek + 1);
            else simple.setUTCDate(simple.getUTCDate() + 8 - dayOfWeek);
            return simple;
        }
        function formatDateYMD(d) {
            const yyyy = d.getUTCFullYear();
            const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
            const dd = String(d.getUTCDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
        }
        function getWeeksInYear(year) {
            const d = new Date(Date.UTC(year, 11, 31));
            return getISOWeekJS(d).week === 1 ? getISOWeekJS(new Date(Date.UTC(year, 11, 24))).week : getISOWeekJS(d).week;
        }

        // 현재 오늘의 주차
        const _todayW = getISOWeekJS(new Date());
        if (!state.activityState) {
            state.activityState = {
                year: String(_todayW.year),
                week: String(_todayW.week),
                statsPeriod: '50',
                data: null,
                loaded: false
            };
        }

        async function loadActivityData() {
            const as = state.activityState;
            showLoading(true);
            const res = await callApi('getActivityData', state.user.staffId, as.year, as.week);
            showLoading(false);
            if (res && res.success) {
                as.data = res;
                as.loaded = true;
            } else {
                as.data = null;
                as.loaded = true;
                alert('활동 데이터 로드 실패: ' + (res ? res.message : '알 수 없는 오류'));
            }
            renderActivityView();
        }

        function renderActivityView() {
            const main = document.getElementById('main-view');
            if (main) {
                main.innerHTML = '';
                main.appendChild(createActivityView());
            }
        }

        async function saveActivityRow(week, type) {
            const as = state.activityState;
            const prefix = `act_${week}_${type}`;
            const fields = ['TA', 'AP', 'P', 'C', 'N', '소개', '보험료'];
            const data = {};
            fields.forEach(f => {
                const dEl = document.getElementById(`${prefix}_${f}`);
                const mEl = document.getElementById(`mob_${prefix}_${f}`);
                const el = (mEl && mEl.offsetParent !== null) ? mEl : dEl;
                const rawVal = el ? String(el.value).replace(/,/g, '') : '0';
                data[f] = Number(rawVal) || 0;
            });
            data['활동계'] = (data['TA'] || 0) + (data['AP'] || 0) + (data['P'] || 0) + (data['C'] || 0) + (data['N'] || 0) + (data['소개'] || 0);

            showLoading(true);
            const res = await callApi('saveActivityData',
                state.user.staffId,
                state.user.name,
                state.user.organization,
                as.year,
                String(week),
                type,
                data
            );
            showLoading(false);

            if (!res || !res.success) {
                alert('저장 실패: ' + (res ? res.message : '알 수 없는 오류'));
            }
        }

        function resetActivityRow(week, type) {
            const prefix = `act_${week}_${type}`;
            ['TA', 'AP', 'P', 'C', 'N', '소개', '보험료'].forEach(f => {
                const dEl = document.getElementById(`${prefix}_${f}`);
                const mEl = document.getElementById(`mob_${prefix}_${f}`);
                if (dEl) dEl.value = '';
                if (mEl) mEl.value = '';
            });
            const dTot = document.getElementById(`${prefix}_활동계`);
            const mTot = document.getElementById(`mob_${prefix}_활동계`);
            if (dTot) dTot.textContent = '';
            if (mTot) mTot.textContent = '';
        }

        function updateActivityTotal(week, type) {
            const prefix = `act_${week}_${type}`;
            const fields = ['TA', 'AP', 'P', 'C', 'N', '소개'];
            let total = 0;
            fields.forEach(f => {
                const dEl = document.getElementById(`${prefix}_${f}`);
                const mEl = document.getElementById(`mob_${prefix}_${f}`);
                const el = (mEl && mEl.offsetParent !== null) ? mEl : dEl;
                const rawVal = el ? String(el.value).replace(/,/g, '') : '0';
                total += Number(rawVal) || 0;
            });
            const dTot = document.getElementById(`${prefix}_활동계`);
            const mTot = document.getElementById(`mob_${prefix}_활동계`);
            if (dTot) dTot.textContent = total > 0 ? total : '';
            if (mTot) mTot.textContent = total > 0 ? total : '';
        }

        function syncActInput(wk, tp, field, val) {
            const dEl = document.getElementById(`act_${wk}_${tp}_${field}`);
            const mEl = document.getElementById(`mob_act_${wk}_${tp}_${field}`);
            if (dEl && dEl.value !== val) dEl.value = val;
            if (mEl && mEl.value !== val) mEl.value = val;
        }

        function createActivityView() {
            const div = document.createElement('div');
            const as = state.activityState;
            const today = new Date();
            const todayW = getISOWeekJS(today);

            // 연도 선택 옵션 (현재연도 ±2)
            const currentYearNum = parseInt(as.year);
            const yearOptions = [];
            for (let y = currentYearNum - 2; y <= currentYearNum + 2; y++) {
                yearOptions.push(`<option value="${y}" ${String(y) === as.year ? 'selected' : ''}>${y}년</option>`);
            }
            const statsPeriodOptions = [50, 25, 12, 4].map(p =>
                `<option value="${p}" ${String(p) === as.statsPeriod ? 'selected' : ''}>직전 ${p}주</option>`
            );

            // 주차 선택 옵션
            const maxWeek = getWeeksInYear(parseInt(as.year));
            const weekOptions = [];
            for (let w = 1; w <= maxWeek; w++) {
                let labelExtra = '';
                if (w === todayW.week) {
                    labelExtra = ' (이번주)';
                } else if (w === todayW.week - 1) {
                    labelExtra = ' (지난주)';
                } else if (w === todayW.week + 1) {
                    labelExtra = ' (다음주)';
                } else {
                    const sd = getMonday(parseInt(as.year), w);
                    labelExtra = ` (${formatDateYMD(sd)})`;
                }
                const isSelected = String(w) === as.week ? 'selected' : '';
                weekOptions.push(`<option value="${w}" ${isSelected}>${w}주${labelExtra}</option>`);
            }

            const curWeekNum = parseInt(as.week);
            const nextWeekNum = curWeekNum + 1;
            const prevWeekNum = curWeekNum - 1;
            const curMonday = getMonday(parseInt(as.year), curWeekNum);
            const nextMonday = getMonday(parseInt(as.year), nextWeekNum);
            const prevMonday = getMonday(parseInt(as.year), prevWeekNum);
            const curStartDate = formatDateYMD(curMonday);
            const nextStartDate = formatDateYMD(nextMonday);
            const prevStartDate = prevWeekNum > 0 ? formatDateYMD(prevMonday) : '';

            // 기존 데이터 추출
            const d = as.data || {};
            const myRows = d.myData || [];
            function getRow(wk, tp) {
                return myRows.find(r => String(r['주차']) === String(wk) && r['예정결과'] === tp) || {};
            }
            const prevResult = getRow(prevWeekNum, '결과');
            const curPlan = getRow(curWeekNum, '예정');
            const curResult = getRow(curWeekNum, '결과');
            const nextPlan = getRow(nextWeekNum, '예정');

            const yt = d.yearlyTotal || {};
            const teamData = d.teamData || [];

            // 통계 계산 (직전 N주 필터링 추가)
            function calcStats(rows) {
                const s = { TA: 0, AP: 0, P: 0, C: 0, N: 0, 소개: 0, 활동계: 0, 보험료: 0 };
                rows.forEach(r => {
                    ['TA', 'AP', 'P', 'C', 'N', '소개', '활동계', '보험료'].forEach(k => { s[k] += Number(r[k] || 0); });
                });
                return s;
            }

            const allData = d.allMyData || [];
            const curTime = curMonday.getTime();
            const N_weeks = parseInt(as.statsPeriod) || 50;
            const pastTimeLimit = curTime - (N_weeks * 7 * 24 * 60 * 60 * 1000);

            const filteredRows = allData.filter(r => {
                const rt = getMonday(parseInt(r['연도']), parseInt(r['주차'])).getTime();
                return rt >= pastTimeLimit && rt < curTime;
            });
            const planRows = filteredRows.filter(r => r['예정결과'] === '예정');
            const resultRows = filteredRows.filter(r => r['예정결과'] === '결과');

            const planData = calcStats(planRows);
            const statData = calcStats(resultRows);
            function safeDiv(a, b) { return b > 0 ? Math.round(a / b * 100) + '%' : '-'; }
            const weekCount = [...new Set(resultRows.map(r => r['연도'] + '-' + r['주차']))].length;
            const nByWeek = {};
            resultRows.forEach(r => {
                const key = r['연도'] + '-' + r['주차'];
                nByWeek[key] = (nByWeek[key] || 0) + Number(r['N'] || 0);
            });
            const weeksWithN = Object.values(nByWeek).filter(n => n >= 1).length;
            const avgN = weeksWithN > 0 ? (weekCount / weeksWithN) : 0;

            // 입력셀 생성 헬퍼
            function inputCell(wk, tp, field, val, bg = 'bg-green-50') {
                const id = `act_${wk}_${tp}_${field}`;
                const alignClass = field === '보험료' ? 'text-right' : 'text-center';

                if (field === '활동계') {
                    const dispVal = val > 0 ? (field === '보험료' ? val.toLocaleString() : val) : '';
                    return `<td class="border border-gray-200 px-1 py-1 text-center text-xs font-bold bg-green-100" id="${id}">${dispVal}</td>`;
                }

                const typeStr = field === '보험료' ? 'type="text"' : 'type="number" min="0"';
                const dispVal = val > 0 ? (field === '보험료' ? val.toLocaleString() : val) : '';
                const formatScript = field === '보험료' ? `this.value = this.value.replace(/[^0-9]/g, '').replace(/\\B(?=(\\d{3})+(?!\\d))/g, ','); ` : '';

                return `<td class="border border-gray-200 px-0 py-0 text-center">
                    <input ${typeStr} id="${id}" value="${dispVal}"
                        class="w-full h-10 px-1 py-1 text-xs ${alignClass} ${bg} border-0 focus:ring-1 focus:ring-green-400 outline-none"
                        oninput="${formatScript}updateActivityTotal(${wk},'${tp}')">
                </td>`;
            }

            function readonlyCell(field, val, cls = '') {
                let dispVal = '';
                if (val !== undefined && val !== '' && val !== 0) {
                    dispVal = field === '보험료' ? Number(val).toLocaleString() : val;
                }
                const alignClass = field === '보험료' ? 'text-right pr-2' : 'text-center';
                return `<td class="border border-gray-200 px-1 py-1 h-10 ${alignClass} text-xs ${cls}">${dispVal}</td>`;
            }

            // 소속원 테이블 행 빌드
            function buildTeamRows() {
                const others = teamData.filter(m => String(m.staffId) !== String(state.user.staffId));
                if (!others.length) return `<tr><td colspan="11" class="text-center text-xs text-gray-400 py-4">소속원 데이터가 없습니다.</td></tr>`;
                return others.map(m => {
                    const wp = m.thisWeekPlan || {};
                    const wr = m.thisWeekResult || {};
                    const cols = ['TA', 'AP', 'P', 'C', 'N', '소개', '활동계', '보험료'];
                    const planRow = `<tr class="hover:bg-gray-50 h-10">
                        <td class="border border-gray-200 px-1 py-1 text-center text-xs" rowspan="2">${m.week}주차</td>
                        <td class="border border-gray-200 px-2 py-1 text-center text-xs font-medium" rowspan="2">${m.name}</td>
                        <td class="border border-gray-200 px-1 py-1 text-center text-xs text-blue-600">예정</td>
                        ${cols.map(c => readonlyCell(c, wp[c] || '')).join('')}
                    </tr>`;
                    const resultRow = `<tr class="bg-gray-50 hover:bg-gray-100 h-10">
                        <td class="border border-gray-200 px-1 py-1 text-center text-xs text-orange-600">결과</td>
                        ${cols.map(c => readonlyCell(c, wr[c] || '')).join('')}
                    </tr>`;
                    return planRow + resultRow;
                }).join('');
            }

            // 소속원 테이블 모바일 뷰 빌드
            function buildTeamMobileRows() {
                const others = teamData.filter(m => String(m.staffId) !== String(state.user.staffId));
                if (!others.length) return `<div class="text-center text-xs text-gray-400 py-4">소속원 데이터가 없습니다.</div>`;
                return others.map(m => {
                    const wp = m.thisWeekPlan || {};
                    const wr = m.thisWeekResult || {};
                    const items = ['TA', 'AP', 'P', 'C', 'N', '소개'];
                    const rowHtml = items.map(k => `
                        <div class="px-1 py-1.5 border-r border-gray-100 last:border-0 text-center">
                            <p class="text-[9px] text-gray-500 mb-0.5">${k}</p>
                            <p class="text-[11px] text-blue-600 font-medium leading-tight">${wp[k] > 0 ? wp[k] : '-'}</p>
                            <p class="text-[11px] text-orange-600 font-medium leading-tight">${wr[k] > 0 ? wr[k] : '-'}</p>
                        </div>
                    `).join('');

                    return `
                    <div class="bg-white border border-gray-200 rounded-xl mb-3 shadow-sm overflow-hidden">
                        <div class="bg-gray-50 px-3 py-2 flex justify-between items-center border-b border-gray-200">
                            <span class="font-bold text-gray-700 text-sm">${m.name} <span class="text-xs font-normal text-gray-500 ml-1">(${m.week}주차)</span></span>
                        </div>
                        <div class="flex">
                            <div class="w-10 flex flex-col justify-end items-end text-right pr-1 pb-1.5 border-r border-gray-100 shrink-0">
                                <p class="text-[9px] text-blue-600 mb-0.5 leading-tight">예정</p>
                                <p class="text-[9px] text-orange-600 leading-tight">결과</p>
                            </div>
                            <div class="grid grid-cols-6 flex-grow">
                                ${rowHtml}
                            </div>
                        </div>
                        <div class="bg-gray-50/50 px-3 py-2 flex justify-between items-center border-t border-gray-100">
                            <div class="text-xs"><span class="text-gray-500 text-[10px]">활동계(예/결) :</span> <span class="font-bold text-gray-700 text-[11px] ml-1">${wp['활동계'] || 0} / ${wr['활동계'] || 0}</span></div>
                            <div class="text-xs"><span class="text-gray-500 text-[10px]">보험료 :</span> <span class="font-bold text-gray-700 text-[11px] ml-1">${Number(wp['보험료'] || 0).toLocaleString()} / ${Number(wr['보험료'] || 0).toLocaleString()}</span></div>
                        </div>
                    </div>`;
                }).join('');
            }

            function mobileInputCell(wk, tp, field, val) {
                const id = `mob_act_${wk}_${tp}_${field}`;
                const alignClass = field === '보험료' ? 'text-right' : 'text-center';

                if (field === '활동계') {
                    const dispVal = val > 0 ? (field === '보험료' ? val.toLocaleString() : val) : '';
                    return `<div class="flex flex-col border border-gray-200 rounded-lg p-2 bg-green-50">
                        <label class="text-[10px] font-bold text-gray-500 mb-1 text-center">${field}</label>
                        <div class="text-sm font-bold text-gray-800 text-center flex-grow flex items-center justify-center" id="${id}">${dispVal}</div>
                    </div>`;
                }

                const typeStr = field === '보험료' ? 'type="text"' : 'type="number" min="0"';
                const dispVal = val > 0 ? (field === '보험료' ? val.toLocaleString() : val) : '';
                const formatScript = field === '보험료' ? `this.value = this.value.replace(/[^0-9]/g, '').replace(/\\B(?=(\\d{3})+(?!\\d))/g, ','); ` : '';

                return `<div class="flex flex-col">
                    <label class="text-[10px] font-bold text-gray-500 mb-1 text-center">${field}</label>
                    <input ${typeStr} id="${id}" value="${dispVal}" placeholder=""
                        class="w-full h-10 px-2 py-1 text-sm ${alignClass} border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-400 outline-none transition"
                        oninput="${formatScript}syncActInput(${wk},'${tp}','${field}',this.value); updateActivityTotal(${wk},'${tp}')">
                </div>`;
            }

            function mobileInputGroup(wk, startDate, tp, dataObj, key, expanded) {
                const titleColor = tp === '예정' ? 'text-blue-600' : 'text-orange-600';
                const bgColors = tp === '결과' ? '' : 'bg-gray-50';
                const arrowIcon = expanded ? '\u25b2' : '\u25bc';
                return `
                <div class="mb-4 rounded-xl border border-gray-200 overflow-hidden shadow-sm ${bgColors}">
                    <div class="bg-gray-100/60 px-3 py-2 flex justify-between items-center border-b border-gray-200 cursor-pointer select-none" onclick="toggleActRow('${key}')">
                        <div class="flex items-center gap-2">
                            <span class="text-sm font-bold text-gray-700">${wk}주차</span>
                            <span class="text-xs text-gray-500">${startDate}</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="text-sm font-bold ${titleColor}">${tp}</span>
                            <span id="mob_arrow_${key}" class="text-gray-400 text-xs ml-1">${arrowIcon}</span>
                        </div>
                    </div>
                    <div id="mob_body_${key}" style="display:${expanded ? 'block' : 'none'}">
                        <div class="p-3">
                            <div class="grid grid-cols-3 gap-2 mb-2">
                                ${mobileInputCell(wk, tp, 'TA', Number(dataObj['TA'] || 0))}
                                ${mobileInputCell(wk, tp, 'AP', Number(dataObj['AP'] || 0))}
                                ${mobileInputCell(wk, tp, 'P', Number(dataObj['P'] || 0))}
                                ${mobileInputCell(wk, tp, 'C', Number(dataObj['C'] || 0))}
                                ${mobileInputCell(wk, tp, 'N', Number(dataObj['N'] || 0))}
                                ${mobileInputCell(wk, tp, '소개', Number(dataObj['소개'] || 0))}
                            </div>
                            <div class="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-gray-100">
                                ${mobileInputCell(wk, tp, '활동계', Number(dataObj['활동계'] || 0))}
                                ${mobileInputCell(wk, tp, '보험료', Number(dataObj['보험료'] || 0))}
                            </div>
                        </div>
                    </div>
                </div>`;
            }

            // 요일 기반 기본 펼침 상태 결정 (1=월요일)
            const isMonday = new Date().getDay() === 1;
            const actExpanded = {
                prevResult: isMonday,
                curPlan: isMonday,
                curResult: !isMonday,
                nextPlan: !isMonday
            };
            const actArrow = (key) => actExpanded[key] ? '\u25bc' : '\u25b6';
            const actDisplay = (key) => actExpanded[key] ? 'table-row' : 'none';

            div.innerHTML = `
            <div class="animate-fadeIn">
                <!-- 헤더 -->
                <div class="flex items-center gap-3 mb-6">
                    <span class="w-1.5 h-6 bg-primary rounded-full"></span>
                    <h2 class="text-xl font-bold text-gray-800">주간 활동 관리 시스템</h2>
                </div>

                <!-- 입력 섹션 -->
                <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-6">
                    <div class="flex flex-wrap items-center gap-3 mb-4">
                        <!-- 연도 선택 -->
                        <div class="relative">
                            <select id="act_year_sel" class="appearance-none bg-yellow-100 border border-yellow-300 text-gray-800 text-sm font-bold rounded-lg px-3 py-2 pr-8 cursor-pointer focus:ring-2 focus:ring-yellow-300 outline-none">
                                ${yearOptions.join('')}
                            </select>
                            <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-600"><svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg></div>
                        </div>
                        <!-- 주차 선택 -->
                        <div class="relative">
                            <select id="act_week_sel" class="appearance-none bg-yellow-100 border border-yellow-300 text-gray-800 text-sm font-bold rounded-lg px-3 py-2 pr-8 cursor-pointer focus:ring-2 focus:ring-yellow-300 outline-none">
                                ${weekOptions.join('')}
                            </select>
                            <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-600"><svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg></div>
                        </div>
                        <span class="text-sm text-gray-600 font-medium block md:inline">${state.user.name}님의 주간 활동 예정 및 결과를 입력해 주세요.</span>
                    </div>

                    <!-- 데스크탑 뷰 -->
                    <div class="overflow-x-auto hidden md:block">
                        <table class="w-full border-collapse text-xs min-w-[600px] table-fixed">
                            <thead>
                                <tr class="bg-blue-50">
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[11%]">주차</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[11%]">시작일</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[11%]">예정/결과</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[8%]">TA</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[8%]">AP</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[8%]">P</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[8%]">C</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[8%]">N</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[8%]">소개</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[8%]">활동 계</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[11%]">보험료 (원)</th>
                                </tr>
                            </thead>
                            <tbody>
                                <!-- 지난주 결과 -->
                                <tr class="bg-gray-50/50 h-10">
                                    <td class="border border-gray-200 px-2 py-1 text-center font-bold text-gray-500 text-xs">${prevWeekNum}주 (지난주)</td>
                                    <td class="border border-gray-200 px-2 py-1 text-center text-gray-500 text-xs">${prevStartDate}</td>
                                    <td class="border border-gray-200 px-2 py-1 text-center text-gray-500 text-xs font-medium">결과</td>
                                    ${inputCell(prevWeekNum, '결과', 'TA', Number(prevResult['TA'] || 0), 'bg-gray-100')}
                                    ${inputCell(prevWeekNum, '결과', 'AP', Number(prevResult['AP'] || 0), 'bg-gray-100')}
                                    ${inputCell(prevWeekNum, '결과', 'P', Number(prevResult['P'] || 0), 'bg-gray-100')}
                                    ${inputCell(prevWeekNum, '결과', 'C', Number(prevResult['C'] || 0), 'bg-gray-100')}
                                    ${inputCell(prevWeekNum, '결과', 'N', Number(prevResult['N'] || 0), 'bg-gray-100')}
                                    ${inputCell(prevWeekNum, '결과', '소개', Number(prevResult['소개'] || 0), 'bg-gray-100')}
                                    ${inputCell(prevWeekNum, '결과', '활동계', Number(prevResult['활동계'] || 0))}
                                    ${inputCell(prevWeekNum, '결과', '보험료', Number(prevResult['보험료'] || 0), 'bg-gray-100')}
                                </tr>
                                <!-- 이번주 예정 -->
                                <tr class="h-10">
                                    <td class="border border-gray-200 px-2 py-1 text-center font-bold text-yellow-700 bg-yellow-50 text-xs" rowspan="2">
                                        ${curWeekNum}주 (이번주)
                                    </td>
                                    <td class="border border-gray-200 px-2 py-1 text-center text-gray-600 text-xs" rowspan="2" id="act_cur_start">${curStartDate}</td>
                                    <td class="border border-gray-200 px-2 py-1 text-center text-blue-600 font-medium">예정</td>
                                    ${inputCell(curWeekNum, '예정', 'TA', Number(curPlan['TA'] || 0))}
                                    ${inputCell(curWeekNum, '예정', 'AP', Number(curPlan['AP'] || 0))}
                                    ${inputCell(curWeekNum, '예정', 'P', Number(curPlan['P'] || 0))}
                                    ${inputCell(curWeekNum, '예정', 'C', Number(curPlan['C'] || 0))}
                                    ${inputCell(curWeekNum, '예정', 'N', Number(curPlan['N'] || 0))}
                                    ${inputCell(curWeekNum, '예정', '소개', Number(curPlan['소개'] || 0))}
                                    ${inputCell(curWeekNum, '예정', '활동계', Number(curPlan['활동계'] || 0))}
                                    ${inputCell(curWeekNum, '예정', '보험료', Number(curPlan['보험료'] || 0))}
                                </tr>
                                <!-- 이번주 결과 -->
                                <tr class="h-10">
                                    <td class="border border-gray-200 px-2 py-1 text-center text-orange-600 font-medium">결과</td>
                                    ${inputCell(curWeekNum, '결과', 'TA', Number(curResult['TA'] || 0))}
                                    ${inputCell(curWeekNum, '결과', 'AP', Number(curResult['AP'] || 0))}
                                    ${inputCell(curWeekNum, '결과', 'P', Number(curResult['P'] || 0))}
                                    ${inputCell(curWeekNum, '결과', 'C', Number(curResult['C'] || 0))}
                                    ${inputCell(curWeekNum, '결과', 'N', Number(curResult['N'] || 0))}
                                    ${inputCell(curWeekNum, '결과', '소개', Number(curResult['소개'] || 0))}
                                    ${inputCell(curWeekNum, '결과', '활동계', Number(curResult['활동계'] || 0))}
                                    ${inputCell(curWeekNum, '결과', '보험료', Number(curResult['보험료'] || 0))}
                                </tr>
                                <!-- 다음주 예정 -->
                                <tr class="bg-gray-50/50 h-10">
                                    <td class="border border-gray-200 px-2 py-1 text-center text-gray-500 text-xs">${nextWeekNum}주 (다음주)</td>
                                    <td class="border border-gray-200 px-2 py-1 text-center text-gray-500 text-xs" id="act_next_start">${nextStartDate}</td>
                                    <td class="border border-gray-200 px-2 py-1 text-center text-blue-500 text-xs">예정</td>
                                    ${inputCell(nextWeekNum, '예정', 'TA', Number(nextPlan['TA'] || 0), 'bg-green-50/70')}
                                    ${inputCell(nextWeekNum, '예정', 'AP', Number(nextPlan['AP'] || 0), 'bg-green-50/70')}
                                    ${inputCell(nextWeekNum, '예정', 'P', Number(nextPlan['P'] || 0), 'bg-green-50/70')}
                                    ${inputCell(nextWeekNum, '예정', 'C', Number(nextPlan['C'] || 0), 'bg-green-50/70')}
                                    ${inputCell(nextWeekNum, '예정', 'N', Number(nextPlan['N'] || 0), 'bg-green-50/70')}
                                    ${inputCell(nextWeekNum, '예정', '소개', Number(nextPlan['소개'] || 0), 'bg-green-50/70')}
                                    ${inputCell(nextWeekNum, '예정', '활동계', Number(nextPlan['활동계'] || 0))}
                                    ${inputCell(nextWeekNum, '예정', '보험료', Number(nextPlan['보험료'] || 0), 'bg-green-50/70')}
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <!-- 모바일 뷰 -->
                    <div class="block md:hidden">
                        ${prevWeekNum > 0 ? mobileInputGroup(prevWeekNum, prevStartDate, '결과', prevResult, 'prevResult', actExpanded.prevResult) : ''}
                        ${mobileInputGroup(curWeekNum, curStartDate, '예정', curPlan, 'curPlan', actExpanded.curPlan)}
                        ${mobileInputGroup(curWeekNum, curStartDate, '결과', curResult, 'curResult', actExpanded.curResult)}
                        ${mobileInputGroup(nextWeekNum, nextStartDate, '예정', nextPlan, 'nextPlan', actExpanded.nextPlan)}
                    </div>

                    <!-- 버튼 -->
                    <div class="flex justify-end gap-2 mt-3">
                        <button onclick="resetActivityInputs()" class="px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition font-medium">초기화</button>
                        <button onclick="saveAllActivityRows()" class="px-4 py-2 text-sm bg-primary hover:bg-primaryHover text-white rounded-lg transition font-bold shadow-sm">저장</button>
                    </div>

                    <!-- 연간 총 활동 결과 -->
                    <div class="mt-5 overflow-x-auto hidden md:block">
                        <table class="w-full border-collapse text-xs min-w-[600px] table-fixed">
                            <thead>
                                <tr class="bg-blue-50">
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[15%]">활동 구분</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[10%]">TA</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[10%]">AP</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[10%]">P</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[10%]">C</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[10%]">N</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[10%]">소개</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[10%]">활동 계</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[15%]">보험료 (원)</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr class="hover:bg-gray-50">
                                    <td class="border border-gray-200 px-2 py-2 text-center text-xs font-medium text-gray-600">연간 총 활동 결과</td>
                                    ${['TA', 'AP', 'P', 'C', 'N', '소개', '활동계', '보험료'].map(k => `<td class="border border-gray-200 px-2 py-2 text-xs font-semibold text-gray-700 ${k === '보험료' ? 'text-right pr-2' : 'text-center'}">${yt[k] > 0 ? yt[k].toLocaleString() : ''}</td>`).join('')}
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <!-- 연간 총 활동 결과 모바일 뷰 -->
                    <div class="mt-5 block md:hidden">
                        <h4 class="text-sm font-bold text-gray-700 mb-3 ml-1">연간 총 활동 결과</h4>
                        <div class="grid grid-cols-3 gap-2">
                            ${['TA', 'AP', 'P', 'C', 'N', '소개'].map(k => `
                            <div class="bg-gray-50 border border-gray-200 rounded-lg p-2 text-center">
                                <p class="text-[11px] font-bold text-gray-500 mb-1">${k}</p>
                                <p class="text-sm font-bold text-gray-800">${yt[k] > 0 ? yt[k].toLocaleString() : '-'}</p>
                            </div>
                            `).join('')}
                        </div>
                        <div class="grid grid-cols-2 gap-2 mt-2">
                            ${['활동계', '보험료'].map(k => `
                            <div class="bg-indigo-50 border border-indigo-100 rounded-lg p-2 text-center">
                                <p class="text-[11px] font-bold text-indigo-500 mb-1">${k}</p>
                                <p class="text-sm font-bold text-indigo-700">${yt[k] > 0 ? yt[k].toLocaleString() : '-'}</p>
                            </div>
                            `).join('')}
                        </div>
                    </div>

                </div>

                <!-- 나의 활동 결과 통계 -->
                <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-6">
                    <div class="flex items-center gap-2 mb-4">
                        <span class="w-1.5 h-4 bg-primary rounded-full"></span>
                        <h3 class="text-sm font-bold text-gray-700">나의 활동 결과 통계</h3>
                    </div>
                    <div class="flex flex-wrap items-center gap-3 mb-4">
                        <div class="relative">
                            <select id="act_stats_period_sel" class="appearance-none bg-yellow-100 border border-yellow-300 text-gray-800 text-sm font-bold rounded-lg px-3 py-2 pr-8 cursor-pointer focus:ring-2 focus:ring-yellow-300 outline-none">
                                ${statsPeriodOptions.join('')}
                            </select>
                            <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-600"><svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg></div>
                        </div>
                        <span class="text-sm text-gray-600">${state.user.name}님의 설정된 기간 동안의 누적 활동 결과에 따른 통계입니다. 이 수치는 각 활동의 유효성을 가늠하는 데 도움이 됩니다.</span>
                    </div>
                    
                    <!-- 예정과 결과 간 확률 -->
                    <div class="overflow-x-auto mb-4 hidden md:block">
                        <table class="w-full border-collapse text-xs min-w-[600px] table-fixed">
                            <thead>
                                <tr class="bg-blue-50">
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[15%]">활동 구분</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[10%]">TA</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[10%]">AP</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[10%]">P</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[10%]">C</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[10%]">N</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[10%]">소개</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[10%]">활동 계</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[15%]">보험료 (원)</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr class="hover:bg-gray-50">
                                    <td class="border border-gray-200 px-2 py-2 text-center text-xs font-medium text-gray-600">총 예정</td>
                                    ${['TA', 'AP', 'P', 'C', 'N', '소개', '활동계', '보험료'].map(k => {
                const plan = planData ? Number(planData[k] || 0) : 0;
                return `<td class="border border-gray-200 px-2 py-2 text-xs font-semibold text-gray-700 ${k === '보험료' ? 'text-right pr-2' : 'text-center'}">${plan > 0 ? plan.toLocaleString() : '-'}</td>`;
            }).join('')}
                                </tr>
                                <tr class="bg-gray-100 hover:bg-gray-200">
                                    <td class="border border-gray-200 px-2 py-2 text-center text-xs font-medium text-gray-600">총 결과</td>
                                    ${['TA', 'AP', 'P', 'C', 'N', '소개', '활동계', '보험료'].map(k => {
                const result = statData ? Number(statData[k] || 0) : 0;
                return `<td class="border border-gray-200 px-2 py-2 text-xs font-semibold text-gray-700 ${k === '보험료' ? 'text-right pr-2' : 'text-center'}">${result > 0 ? result.toLocaleString() : '-'}</td>`;
            }).join('')}
                                </tr>
                                <tr class="hover:bg-gray-50">
                                    <td class="border border-gray-200 px-2 py-2 text-center text-xs font-medium text-gray-600">예정과 결과 간 확률</td>
                                    ${['TA', 'AP', 'P', 'C', 'N', '소개', '활동계', '보험료'].map(k => {
                const plan = planData ? Number(planData[k] || 0) : 0;
                const result = statData ? Number(statData[k] || 0) : 0;
                return `<td class="border border-gray-200 px-2 py-2 text-xs text-center">${plan > 0 ? Math.round(result / plan * 100) + '%' : '-'}</td>`;
            }).join('')}
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <!-- 예정과 결과 간 확률 모바일 뷰 -->
                    <div class="mb-6 block md:hidden">
                        <div class="grid grid-cols-2 gap-3">
                            ${['TA', 'AP', 'P', 'C', 'N', '소개'].map(k => {
                const plan = planData ? Number(planData[k] || 0) : 0;
                const result = statData ? Number(statData[k] || 0) : 0;
                const prob = plan > 0 ? Math.round(result / plan * 100) + '%' : '-';
                return `
                                <div class="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                                    <h4 class="text-xs font-bold text-gray-700 bg-gray-50 border-b border-gray-200 p-2 text-center">${k}</h4>
                                    <div class="p-2">
                                        <div class="flex justify-between items-center mb-1">
                                            <span class="text-[10px] text-gray-500 font-medium">총 예정</span>
                                            <span class="text-[11px] font-bold text-gray-700">${plan > 0 ? plan.toLocaleString() : '-'}</span>
                                        </div>
                                        <div class="flex justify-between items-center mb-2">
                                            <span class="text-[10px] text-gray-500 font-medium">총 결과</span>
                                            <span class="text-[11px] font-bold text-gray-800">${result > 0 ? result.toLocaleString() : '-'}</span>
                                        </div>
                                        <div class="flex justify-between items-center bg-blue-50/50 -mx-2 -mb-2 p-2 border-t border-blue-100">
                                            <span class="text-[10px] text-blue-600 font-bold">확률</span>
                                            <span class="text-xs font-bold text-blue-700">${prob}</span>
                                        </div>
                                    </div>
                                </div>
                                `;
            }).join('')}
                        </div>
                    </div>

                    <div class="overflow-x-auto hidden md:block">
                        <table class="w-full border-collapse text-xs min-w-[600px] table-fixed">
                            <thead>
                                <tr class="bg-blue-50">
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[10%]">구분</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[10%]">TA / AP</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[10%]">AP / P</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[10%]">P / C</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[10%]">TA / N</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[10%]">AP / N</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[10%]">P / N</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[10%]">C / N</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[10%]">AP / 소개</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[10%]">주간 유실적률</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr class="hover:bg-gray-50">
                                    <td class="border border-gray-200 px-2 py-2 text-center text-xs font-medium text-gray-600">활동 간 확률</td>
                                    <td class="border border-gray-200 px-2 py-2 text-center text-xs bg-yellow-50/50">${safeDiv(statData.AP, statData.TA)}</td>
                                    <td class="border border-gray-200 px-2 py-2 text-center text-xs">${safeDiv(statData.P, statData.AP)}</td>
                                    <td class="border border-gray-200 px-2 py-2 text-center text-xs">${safeDiv(statData.C, statData.P)}</td>
                                    <td class="border border-gray-200 px-2 py-2 text-center text-xs">${safeDiv(statData.N, statData.TA)}</td>
                                    <td class="border border-gray-200 px-2 py-2 text-center text-xs bg-yellow-50/50">${safeDiv(statData.N, statData.AP)}</td>
                                    <td class="border border-gray-200 px-2 py-2 text-center text-xs">${safeDiv(statData.N, statData.P)}</td>
                                    <td class="border border-gray-200 px-2 py-2 text-center text-xs">${safeDiv(statData.N, statData.C)}</td>
                                    <td class="border border-gray-200 px-2 py-2 text-center text-xs bg-yellow-50/50">${safeDiv(statData.소개, statData.AP)}</td>
                                    <td class="border border-gray-200 px-2 py-2 text-center text-xs">${avgN > 0 ? Math.round(avgN * 100) + '%' : '-'}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <!-- 활동 간 확률 모바일 뷰 -->
                    <div class="block md:hidden mt-2">
                        <h4 class="text-sm font-bold text-gray-700 mb-3 ml-1">활동 간 확률</h4>
                        <div class="grid grid-cols-2 gap-2">
                            ${[
                    { label: 'TA / AP', val: safeDiv(statData.AP, statData.TA), highlight: true },
                    { label: 'AP / P', val: safeDiv(statData.P, statData.AP), highlight: false },
                    { label: 'P / C', val: safeDiv(statData.C, statData.P), highlight: false },
                    { label: 'TA / N', val: safeDiv(statData.N, statData.TA), highlight: false },
                    { label: 'AP / N', val: safeDiv(statData.N, statData.AP), highlight: true },
                    { label: 'P / N', val: safeDiv(statData.N, statData.P), highlight: false },
                    { label: 'C / N', val: safeDiv(statData.N, statData.C), highlight: false },
                    { label: 'AP / 소개', val: safeDiv(statData.소개, statData.AP), highlight: true }
                ].map(item => `
                            <div class="${item.highlight ? 'bg-yellow-50/70 border-yellow-200' : 'bg-gray-50 border-gray-200'} border rounded-lg p-2 flex justify-between items-center">
                                <span class="text-[11px] font-bold ${item.highlight ? 'text-yellow-700' : 'text-gray-500'}">${item.label}</span>
                                <span class="text-xs font-bold ${item.highlight ? 'text-yellow-800' : 'text-gray-800'}">${item.val}</span>
                            </div>
                            `).join('')}
                        </div>
                        <div class="mt-2 bg-blue-50 border border-blue-200 rounded-lg p-3 flex justify-between items-center">
                            <span class="text-xs font-bold text-blue-700">주간 유실적률</span>
                            <span class="text-sm font-bold text-blue-800">${avgN > 0 ? Math.round(avgN * 100) + '%' : '-'}</span>
                        </div>
                    </div>
                </div>

                <!-- 소속원들의 주간 활동 -->
                <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                    <div class="flex items-center gap-2 mb-4">
                        <span class="w-1.5 h-4 bg-primary rounded-full"></span>
                        <h3 class="text-sm font-bold text-gray-700">소속원들의 주간 활동은?</h3>
                    </div>
                    <div class="overflow-x-auto hidden md:block">
                        <table class="w-full border-collapse text-xs min-w-[600px] table-fixed">
                            <thead>
                                <tr class="bg-blue-50">
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[11%]">주차</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[11%]">이름</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[11%]">예정/결과</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[8%]">TA</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[8%]">AP</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[8%]">P</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[8%]">C</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[8%]">N</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[8%]">소개</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[8%]">활동 계</th>
                                    <th class="border border-gray-200 px-2 py-2 text-center font-bold text-gray-700 w-[11%]">보험료 (원)</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${buildTeamRows()}
                            </tbody>
                        </table>
                    </div>

                    <!-- 소속원 모바일 뷰 -->
                    <div class="block md:hidden">
                        ${buildTeamMobileRows()}
                    </div>
                </div>
            </div>`;

            // 이벤트 연결
            setTimeout(() => {
                // 연도 선택
                const yearSel = div.querySelector('#act_year_sel');
                if (yearSel) yearSel.addEventListener('change', e => {
                    state.activityState.year = e.target.value;
                    state.activityState.loaded = false;
                    loadActivityData();
                });
                // 주차 선택
                const weekSel = div.querySelector('#act_week_sel');
                if (weekSel) weekSel.addEventListener('change', e => {
                    state.activityState.week = e.target.value;
                    state.activityState.loaded = false;
                    loadActivityData();
                });
                // 통계 기간 선택
                const statsPeriodSel = div.querySelector('#act_stats_period_sel');
                if (statsPeriodSel) statsPeriodSel.addEventListener('change', e => {
                    state.activityState.statsPeriod = e.target.value;
                    renderActivityView();
                });
            }, 0);

            return div;
        }

        window.saveAllActivityRows = async function () {
            const as = state.activityState;
            const curWeekNum = parseInt(as.week);
            const nextWeekNum = curWeekNum + 1;
            const prevWeekNum = curWeekNum > 1 ? curWeekNum - 1 : 0;

            const now = new Date();
            const timestamp = now.getFullYear() + '-' +
                String(now.getMonth() + 1).padStart(2, '0') + '-' +
                String(now.getDate()).padStart(2, '0') + ' ' +
                String(now.getHours()).padStart(2, '0') + ':' +
                String(now.getMinutes()).padStart(2, '0') + ':' +
                String(now.getSeconds()).padStart(2, '0');

            function collectRow(week, type) {
                if (week <= 0) return null;
                const prefix = `act_${week}_${type}`;
                const fields = ['TA', 'AP', 'P', 'C', 'N', '소개', '보험료'];
                const data = {};
                fields.forEach(f => {
                    const el = document.getElementById(`${prefix}_${f}`);
                    const rawVal = el ? String(el.value).replace(/,/g, '') : '0';
                    data[f] = Number(rawVal) || 0;
                });
                data['활동계'] = (data['TA'] || 0) + (data['AP'] || 0) + (data['P'] || 0) + (data['C'] || 0) + (data['N'] || 0) + (data['소개'] || 0);
                data['입력시간'] = timestamp;
                return { year: as.year, week: String(week), type: type, data: data };
            }

            const batchData = [
                collectRow(prevWeekNum, '결과'),
                collectRow(curWeekNum, '예정'),
                collectRow(curWeekNum, '결과'),
                collectRow(nextWeekNum, '예정')
            ].filter(item => item !== null);

            showLoading(true);
            const res = await callApi('saveActivityDataBatch',
                state.user.staffId,
                state.user.name,
                state.user.organization,
                batchData
            );

            if (!res || !res.success) {
                showLoading(false);
                alert('저장 실패: ' + (res ? res.message : '알 수 없는 오류'));
            } else {
                await loadActivityData();
                showLoading(false);
            }
        };

        window.resetActivityInputs = function () {
            const as = state.activityState;
            const curWeekNum = parseInt(as.week);
            const nextWeekNum = curWeekNum + 1;
            resetActivityRow(curWeekNum, '예정');
            resetActivityRow(curWeekNum, '결과');
            resetActivityRow(nextWeekNum, '예정');
        };

        window.toggleActRow = function (key) {
            // 데스크탑: table row
            const row = document.getElementById('act_row_' + key);
            const arrow = document.getElementById('act_arrow_' + key);
            // 모바일: div body
            const mobBody = document.getElementById('mob_body_' + key);
            const mobArrow = document.getElementById('mob_arrow_' + key);

            const isCurrentlyHidden =
                (row && row.style.display === 'none') ||
                (mobBody && mobBody.style.display === 'none');

            if (row) {
                row.style.display = isCurrentlyHidden ? 'table-row' : 'none';
            }
            if (arrow) {
                arrow.textContent = isCurrentlyHidden ? '\u25bc' : '\u25b6';
            }
            if (mobBody) {
                mobBody.style.display = isCurrentlyHidden ? 'block' : 'none';
            }
            if (mobArrow) {
                mobArrow.textContent = isCurrentlyHidden ? '\u25b2' : '\u25bc';
            }
        };

        window.showRecruitmentDetails = function (type) {
            const list = state.data.recData?.downlines || [];

            let nlPrem = 0, lComm = 0, nlTarget = 0, lTarget = 0;
            list.forEach(x => {
                if (type === 'pay') {
                    nlPrem += Number(x['손보신계약'] || 0);
                    lComm += Number(x['생보신계약유지'] || 0);
                    nlTarget += Number(x['손보월발생분'] || 0);
                    lTarget += Number(x['생보월발생분'] || 0);
                } else {
                    nlPrem += Number(x['손보환수'] || 0);
                    lComm += Number(x['생보환수'] || 0);
                    nlTarget += Number(x['손보월환수분'] || 0);
                    lTarget += Number(x['생보월환수분'] || 0);
                }
            });

            const totalTarget = nlTarget + lTarget;
            const title = type === 'pay' ? '증원수당 지급액 상세내역' : '증원수당 환수액 상세내역';
            const valueLabel = type === 'pay' ? '지급액' : '환수액';

            document.body.classList.add('modal-open');
            const modal = document.createElement('div');
            modal.className = "fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 fade-in";

            const colBgHeader = type === 'pay' ? 'bg-blue-50/80 text-blue-700' : 'bg-red-50/80 text-red-700';
            const colBgBody = type === 'pay' ? 'bg-blue-50/30' : 'bg-red-50/30';

            modal.innerHTML = `
                <div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh] overflow-hidden transform transition-all scale-100 ring-1 ring-black/5">
                    <div class="px-6 py-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                        <h3 class="text-xl font-bold text-gray-800 tracking-tight flex items-center gap-2">
                            <span class="w-1.5 h-6 rounded-full ${type === 'pay' ? 'bg-blue-500' : 'bg-red-500'}"></span>
                            ${title}
                        </h3>
                        <button class="close text-gray-400 hover:text-gray-600 transition p-2 hover:bg-white rounded-xl">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                    </div>
                    
                    <div class="p-6 overflow-y-auto bg-gray-50 flex-grow">
                        <div class="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                            <div class="overflow-x-auto">
                                <table class="w-full text-sm text-left">
                                    <thead class="text-xs text-gray-700 bg-gray-100 border-b border-gray-200">
                                        <tr>
                                            <th class="px-4 py-3 font-bold text-center border-r border-gray-200">손보 총보험료</th>
                                            <th class="px-4 py-3 font-bold text-center border-r border-gray-200">생보 총수수료</th>
                                            <th class="px-4 py-3 font-bold text-center border-r border-gray-200 ${colBgHeader}">손보 ${valueLabel}</th>
                                            <th class="px-4 py-3 font-bold text-center border-r border-gray-200 ${colBgHeader}">생보 ${valueLabel}</th>
                                            <th class="px-4 py-3 font-bold text-center bg-orange-50 text-primary">${valueLabel} 합계</th>
                                        </tr>
                                    </thead>
                                    <tbody class="divide-y divide-gray-100">
                                        <tr class="hover:bg-gray-50 transition">
                                            <td class="px-4 py-4 text-center border-r border-gray-100 font-medium text-gray-800">${formatMoney(nlPrem)}</td>
                                            <td class="px-4 py-4 text-center border-r border-gray-100 font-medium text-gray-800">${formatMoney(lComm)}</td>
                                            <td class="px-4 py-4 text-center border-r border-gray-100 font-medium text-gray-800 ${colBgBody}">${formatMoney(nlTarget)}</td>
                                            <td class="px-4 py-4 text-center border-r border-gray-100 font-medium text-gray-800 ${colBgBody}">${formatMoney(lTarget)}</td>
                                            <td class="px-4 py-4 text-center font-bold text-primary bg-orange-50/30">${formatMoney(totalTarget)}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <p class="text-xs text-gray-400 mt-4 text-center">※ 위 금액은 해당 월 산하 인원(${list.length}명)의 실적을 합산한 결과입니다.</p>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            const closeFn = () => {
                document.body.classList.remove('modal-open');
                modal.remove();
            };
            modal.querySelector('.close').onclick = closeFn;
            modal.onclick = (e) => {
                if (e.target === modal) closeFn();
            };
        };

        function createRecruitmentView() {
            if (state.isLoading) return getSkeletonUI();
            const div = document.createElement('div');

            const canViewMembers = isDashboardMemberViewable();
            const selectedMember = state.recruitmentSelectedMember;
            const displayName = selectedMember ? selectedMember.name : state.user.name;

            // 소속원 선택 콤보박스 HTML
            const memberSelectorHtml = canViewMembers ? `
            <div class="relative w-full md:w-[350px]" id="rec-member-dropdown-wrapper">
                <div class="relative">
                    <input
                        type="text"
                        id="rec-member-search"
                        placeholder="소속원 검색 및 선택..."
                        value="${selectedMember ? selectedMember.name : ''}"
                        autocomplete="off"
                        class="w-full pl-9 pr-10 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition cursor-pointer shadow-sm"
                        readonly
                    />
                    <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                    </div>
                    <div class="absolute inset-y-0 right-0 pr-3 flex items-center gap-1">
                        ${selectedMember ? `
                        <button id="rec-member-clear-btn" class="p-1 hover:bg-red-50 rounded-full text-red-400 hover:text-red-600 transition" title="내 증원수당 보기">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>` : ''}
                        <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </div>
                </div>
                <!-- 드롭다운 목록 -->
                <div id="rec-member-list" class="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 hidden max-h-80 overflow-hidden">
                    <div class="p-2 border-b border-gray-100 bg-gray-50/50">
                        <div class="relative">
                            <input
                                type="text"
                                id="rec-member-filter"
                                placeholder="데이터가 있는 소속원 찾기..."
                                autocomplete="off"
                                class="w-full pl-8 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                            />
                            <div class="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                                <svg class="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                            </div>
                        </div>
                    </div>
                    <div id="rec-member-options" class="overflow-y-auto max-h-60 scrollbar-elegant">
                        <div class="px-4 py-8 text-center text-gray-400 text-xs italic">데이터 확인 중...</div>
                    </div>
                </div>
            </div>` : '';

            div.innerHTML = `
             <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                <div>
                   <h2 class="text-xl font-bold text-gray-800 tracking-tight" id="rec-title">${displayName}님의 증원수당 (${state.currentMonth})</h2>
                   <p class="text-gray-500 text-sm mt-1">증원수당 및 차수별 산하인원 현황입니다.</p>
                </div>
                ${memberSelectorHtml}
             </div>
             
             <div id="rec-data-container">
                <div class="flex items-center justify-center h-48">
                    <div class="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                </div>
             </div>`;

            // 데이터 렌더링 내부 함수
            const renderContent = (recData, isLoading = false) => {
                const container = div.querySelector('#rec-data-container');
                if (!container) return;

                if (isLoading) {
                    container.innerHTML = `<div class="flex items-center justify-center h-48"><div class="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div></div>`;
                    return;
                }

                const d = recData || { myStats: {}, downlines: [] };
                const groups = { 1: [], 2: [], 3: [], 4: [] };
                (d.downlines || []).forEach(x => { if (groups[x.level]) groups[x.level].push(x); });

                const calcItem = (item) => {
                    const np = Number(item['손보월발생분'] || 0); const lp = Number(item['생보월발생분'] || 0);
                    const nr = Number(item['손보월환수분'] || 0); const lr = Number(item['생보월환수분'] || 0);
                    return { pay: np + lp, refund: nr + lr, net: np + lp + nr + lr };
                };
                let agg = { pay: 0, refund: 0, net: 0 };
                (d.downlines || []).forEach(item => { const res = calcItem(item); agg.pay += res.pay; agg.refund += res.refund; agg.net += res.net; });

                const card = (label, val, color, isRed = false, big = false, onClickHandler = null) => `
                  <div ${onClickHandler ? `onclick="${onClickHandler}" class="cursor-pointer hover:shadow-md hover:bg-gray-50 transition bg-white rounded-2xl shadow-sm p-5 border-l-4 ${color} flex flex-col justify-between h-full items-center text-center"` : `class="bg-white rounded-2xl shadow-sm p-5 border-l-4 ${color} flex flex-col justify-between h-full items-center text-center"`}>
                     <p class="text-gray-400 text-xs w-full text-center font-bold uppercase tracking-tight">${label}</p>
                     <p class="${big ? 'text-2xl' : 'text-xl'} font-extrabold ${isRed || (val < 0) ? 'text-red-500' : 'text-gray-800'} mt-2 tracking-tighter">${formatMoney(val)}</p>
                  </div>`;

                let listHtml = '';
                for (let i = 1; i <= 4; i++) {
                    if (groups[i].length === 0) continue;
                    const cards = groups[i].map(x => {
                        const s = calcItem(x);
                        return `<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3 hover:shadow-md transition duration-200">
                        <div class="flex justify-between mb-3 items-center">
                            <div class="flex items-center gap-2"><div class="w-1.5 h-1.5 rounded-full bg-primary/50"></div><span class="font-bold text-gray-900 text-lg">${x['이름']}</span></div>
                            <span class="font-bold text-gray-900 bg-gray-50 px-2 py-1 rounded text-lg">${formatMoney(s.net)}</span>
                        </div>
                        <div class="flex justify-between text-xs bg-gray-50 p-2.5 rounded-lg border border-gray-100">
                           <div class="flex-1 text-center border-r border-gray-200">
                              <span class="text-gray-400 block mb-1 font-medium">지급</span>
                              <span class="text-blue-600 font-bold text-base">${formatMoney(s.pay)}</span>
                           </div>
                           <div class="flex-1 text-center">
                              <span class="text-gray-400 block mb-1 font-medium">환수</span>
                              <span class="text-red-500 font-bold text-base">${formatMoney(s.refund)}</span>
                           </div>
                        </div></div>`;
                    }).join('');
                    listHtml += `<div class="mb-8"><h4 class="font-bold text-gray-600 mb-3 text-sm bg-gray-100/80 px-3 py-2 rounded-lg inline-block">${i}차 산하 <span class="text-primary ml-1">${groups[i].length}명</span></h4><div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">${cards}</div></div>`;
                }

                container.innerHTML = `
                 <div class="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                    <div class="col-span-2 md:col-span-1">${card(displayName + '님의 증원수당 (세전)', agg.net, 'border-primary', false, true)}</div>
                    <div class="col-span-1 md:col-span-1 relative custom-tooltip" data-tooltip="클릭하여 상세내역 확인">${card('총 지급액', agg.pay, 'border-blue-500', false, false, "showRecruitmentDetails('pay')")}</div>
                    <div class="col-span-1 md:col-span-1 relative custom-tooltip" data-tooltip="클릭하여 상세내역 확인">${card('총 환수액', agg.refund, 'border-red-500', true, false, "showRecruitmentDetails('refund')")}</div>
                 </div>
                 <div class="mb-8 text-center"><div class="inline-block px-4 py-2 bg-gray-100 rounded-xl md:rounded-full text-sm text-gray-500 font-medium select-none text-center">💡 Tip: 위 지급/환수 카드를 클릭하면 상세 내역을 볼 수 있습니다.</div></div>
                 ${listHtml}
                 <div class="mt-8 p-6 bg-gray-50 rounded-xl border border-gray-200 text-sm text-gray-600 leading-relaxed shadow-inner">
                    <p class="font-bold mb-2 text-gray-800">※ 증원수당 관련 안내</p>
                    <p class="mb-1">증원수당은 관리자수당이 아닙니다.</p>
                    <p class="mb-1">산하인원의 해당월 실적이 10만원 미만인 경우에는 산하실적에 포함되지 않습니다.</p>
                    <p class="mb-1">실손보험, 재물성보험 등은 산하실적에 포함되지 않습니다. (장기 인보험만 포함)</p>
                    <p class="mb-1">증원수당은 산하인원의 실적과 연계되어 정확하게 계산되고 있음을 안내드립니다.</p>
                    <p class="mb-4">증원수당과 관련하여 궁금하신 부분이 있으시면 언제든 박용수 본부장에게 연락주시기 바랍니다.</p>
                    
                    <p class="font-bold mb-2 text-gray-800">※ 증원수당 계산식</p>
                    <ul class="list-disc list-inside space-y-1 ml-1 text-gray-600 mb-4">
                        <li><span class="font-semibold text-gray-700">손해보험</span> : 신계약보험료 X 30%</li>
                        <li><span class="font-semibold text-gray-700">생명보험</span> : 지급수수료 X 2.25% (유지수수료 포함)</li>
                    </ul>

                    <p class="font-bold mb-2 text-gray-800">※ 증원수당 환수기준 (철회, 취소, 해지, 실효, 타대리점이관)</p>
                    <ul class="list-disc list-inside space-y-1 ml-1 text-gray-600">
                        <li>18회차 미유지시 100% 환수</li>
                        <li>19회차~24회차 미유지시 85, 75, 60, 45, 30, 15% 환수</li>
                        <li>부활시, 재지급 하지 않음</li>
                        <li>불완전판매 계약으로 판명 시 해당 계약 제외</li>
                    </ul>
                 </div>`;
            };

            // 데이터 로드 로직
            if (selectedMember) {
                const cacheKey = `DATA_${selectedMember.id}_${state.currentMonth}_recruitment`;
                const cached = sessionStorage.getItem(cacheKey);
                if (cached) {
                    try { 
                        const parsed = JSON.parse(cached);
                        state.data.recData = parsed; 
                        renderContent(parsed); 
                    } catch (e) { renderContent(null, true); fetchR(); }
                } else { renderContent(null, true); fetchR(); }
                function fetchR() {
                    callApi('getRecruitmentData', selectedMember.id, state.currentMonth).then(d => {
                        if (!state.user) return;
                        if (d && !d.error) { 
                            sessionStorage.setItem(cacheKey, JSON.stringify(d)); 
                            state.data.recData = d;
                        }
                        renderContent(d && !d.error ? d : null);
                    });
                }
            } else {
                // 본인 데이터인 경우: 초기 로딩 시 이미 state.data.recData에 있을 수 있으나, 명시적으로 처리
                renderContent(state.data.recData);
            }

            // 드롭다운 설정
            if (canViewMembers) {
                setTimeout(() => {
                    const searchInput = div.querySelector('#rec-member-search');
                    const dropdownList = div.querySelector('#rec-member-list');
                    const filterInput = div.querySelector('#rec-member-filter');
                    const optionsContainer = div.querySelector('#rec-member-options');
                    const clearBtn = div.querySelector('#rec-member-clear-btn');

                    const renderOptions = (filterText = '') => {
                        const mList = getRecruitmentMemberList();
                        const fText = filterText.toLowerCase();
                        const filtered = mList.filter(m => String(m.name || '').toLowerCase().includes(fText));

                        if (!optionsContainer) return;

                        const mySelfHtml = (!filterText || state.user.name.toLowerCase().includes(fText)) ?
                            `<div class="rec-member-option px-4 py-2.5 cursor-pointer hover:bg-gray-50 text-sm flex items-center gap-2 transition ${!selectedMember ? 'bg-primary/5 font-bold text-primary' : 'text-gray-600'}" data-id="__self__" data-name="${state.user.name}">
                                <div class="w-1.5 h-1.5 rounded-full ${!selectedMember ? 'bg-primary' : 'bg-gray-300'}"></div>
                                ${state.user.name} <span class="text-[10px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded ml-auto">ME</span>
                            </div>` : '';

                        if (filtered.length === 0 && !mySelfHtml) {
                            optionsContainer.innerHTML = `<div class="px-4 py-8 text-center text-gray-400 text-sm italic">검색 결과가 없습니다.</div>`;
                            return;
                        }

                        optionsContainer.innerHTML = mySelfHtml + filtered.map(m => {
                            const isSelected = selectedMember && String(selectedMember.id) === String(m.id);
                            return `<div class="rec-member-option px-4 py-2.5 cursor-pointer hover:bg-gray-50 text-sm flex items-center gap-2 transition ${isSelected ? 'bg-primary/5 font-bold text-primary' : 'text-gray-700'}" data-id="${m.id}" data-name="${m.name}">
                                <div class="w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-primary' : 'bg-gray-200'}"></div>
                                ${m.name}
                            </div>`;
                        }).join('');

                        optionsContainer.querySelectorAll('.rec-member-option').forEach(el => {
                            el.onclick = () => {
                                const id = el.getAttribute('data-id');
                                const name = el.getAttribute('data-name');
                                if (id === '__self__') { state.recruitmentSelectedMember = null; }
                                else { state.recruitmentSelectedMember = { id, name }; }
                                navigate('recruitment');
                            };
                        });
                    };

                    searchInput.onclick = (e) => {
                        e.stopPropagation();
                        dropdownList.classList.toggle('hidden');
                        if (!dropdownList.classList.contains('hidden')) {
                            renderOptions();
                            filterInput.focus();
                        }
                    };

                    filterInput.onclick = (e) => e.stopPropagation();
                    filterInput.oninput = (e) => renderOptions(e.target.value);

                    if (clearBtn) clearBtn.onclick = (e) => {
                        e.stopPropagation();
                        state.recruitmentSelectedMember = null;
                        navigate('recruitment');
                    };

                    document.addEventListener('click', () => { if (dropdownList) dropdownList.classList.add('hidden'); }, { once: true });
                }, 0);
            }

            return div;
        }

        function createAnomalyAdminView() {
            const div = document.createElement('div');
            const isExecutive = isBranchRepAny() || isOpsAny();
            const scopeLabel = isExecutive ? '전체 파트너' : `소속 파트너 (${state.user.organization || '담당 소속'})`;

            div.innerHTML = `
            <div class="flex flex-col sm:flex-row justify-between mb-6 items-start sm:items-center gap-4">
                <div>
                    <div class="flex items-center gap-2">
                        <h2 class="text-xl font-bold text-gray-800 tracking-tight">이상징후 탐지 AI (${state.currentMonth})</h2>
                        <span class="px-2.5 py-0.5 text-xs font-bold rounded-full bg-indigo-100 text-indigo-700">${scopeLabel}</span>
                    </div>
                    <p class="text-gray-500 text-sm mt-1">유지율, 실효·연체·미납 및 신계약 확인서 데이터를 종합 분석하여 계약관리 리스크를 조기 진단합니다.</p>
                </div>
                <div class="flex space-x-1 bg-gray-100 p-1 rounded-lg self-start sm:self-center">
                    <button onclick="setAT('reward')" class="px-4 py-2 text-sm rounded-md transition duration-200 text-gray-500 hover:text-gray-700">시상금</button>
                    ${!isAdminAny() ? `<button onclick="setAT('recruitment')" class="px-4 py-2 text-sm rounded-md transition duration-200 text-gray-500 hover:text-gray-700">증원수당</button>` : ''}
                    <button onclick="setAT('anomaly')" class="px-4 py-2 text-sm rounded-md transition duration-200 bg-white shadow-sm text-indigo-600 font-bold flex items-center gap-1.5">
                        <svg class="w-4 h-4 text-amber-400" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>
                        <span>이상징후 탐지 AI</span>
                    </button>
                </div>
            </div>

            <!-- 요약 통계 카드 4개 -->
            <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-5 flex flex-col items-center text-center border-l-[5px] border-l-slate-400">
                    <p class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">점검 대상 파트너</p>
                    <p class="text-2xl sm:text-3xl font-extrabold text-gray-800" id="anomaly-stat-total">-</p>
                </div>
                <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-5 flex flex-col items-center text-center border-l-[5px] border-l-red-500">
                    <p class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">🔴 고위험 집중관리</p>
                    <p class="text-2xl sm:text-3xl font-extrabold text-red-500" id="anomaly-stat-danger">-</p>
                </div>
                <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-5 flex flex-col items-center text-center border-l-[5px] border-l-orange-400">
                    <p class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">🟠 경고 주의관리</p>
                    <p class="text-2xl sm:text-3xl font-extrabold text-orange-500" id="anomaly-stat-warning">-</p>
                </div>
                <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-5 flex flex-col items-center text-center border-l-[5px] border-l-purple-500">
                    <p class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">확인서 미제출 발생</p>
                    <p class="text-2xl sm:text-3xl font-extrabold text-purple-600" id="anomaly-stat-unsub">-</p>
                </div>
            </div>

            <!-- Gemini AI 이상징후 종합 전략 진단 배너 -->
            <div id="anomaly-ai-overview-container" class="mb-6"></div>

            <!-- 검색 및 필터 컨트롤 -->
            <div class="mb-6 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4">
                <div class="relative w-full max-w-md">
                    <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <svg class="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd" /></svg>
                    </div>
                    <input type="text" id="anomalySearch" placeholder="파트너 이름 또는 사번 검색" class="w-full pl-11 pr-4 py-2.5 border border-gray-200 rounded-xl bg-white shadow-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition text-sm">
                </div>

                <div class="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
                    <div class="inline-flex p-1 bg-gray-100 rounded-xl gap-1 border border-gray-200/60" id="anomalyRiskFilterGroup">
                        <button data-risk="ALL" class="anomaly-filter-btn px-3 py-1.5 rounded-lg text-xs font-bold transition bg-white shadow-sm text-gray-800">전체</button>
                        <button data-risk="DANGER" class="anomaly-filter-btn px-3 py-1.5 rounded-lg text-xs font-bold transition text-gray-500 hover:text-red-600">🔴 고위험</button>
                        <button data-risk="WARNING" class="anomaly-filter-btn px-3 py-1.5 rounded-lg text-xs font-bold transition text-gray-500 hover:text-orange-600">🟠 경고</button>
                        <button data-risk="CAUTION" class="anomaly-filter-btn px-3 py-1.5 rounded-lg text-xs font-bold transition text-gray-500 hover:text-amber-600">🟡 주의</button>
                        <button data-risk="SAFE" class="anomaly-filter-btn px-3 py-1.5 rounded-lg text-xs font-bold transition text-gray-500 hover:text-emerald-600">🟢 양호</button>
                    </div>
                </div>
            </div>

            <!-- 파트너별 이상징후 카드 그리드 리스트 -->
            <div id="anomalyListContainer" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                <div class="col-span-full flex items-center justify-center py-20">
                    <div class="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                </div>
            </div>`;

            setTimeout(async () => {
                let scoredList = [];

                // 캐시 확인: 동일 월 데이터가 메모리에 존재하면 API 재호출 생략 (0초 즉시 로딩)
                if (state.data.anomalyAdminData && state.data.anomalyAdminMonth === state.currentMonth) {
                    scoredList = state.data.anomalyAdminData;
                } else {
                    let list = [];
                    // 1. 실효연체 데이터 로드 (권한별 격리 적용된 API)
                    try {
                        const res = await callApi('getAdminLapseArrearsSummary', state.user.staffId, 'recruiter');
                        if (res && res.success && res.list) {
                            list = res.list;
                        }
                    } catch (e) {
                        console.error('getAdminLapseArrearsSummary error in anomaly view', e);
                    }

                    // 2. 유지율 데이터 로드 (동일 권한 격리 적용)
                    let retentionMap = {};
                    try {
                        const retRes = await callApi('getAdminRetentionSummary', state.user.staffId);
                        if (retRes && retRes.success && retRes.list) {
                            retRes.list.forEach(r => {
                                retentionMap[String(r.id)] = r;
                            });
                        }
                    } catch (e) {
                        console.error('getAdminRetentionSummary error in anomaly view', e);
                    }

                    // 3. 룰 기반 리스크 스코어링 및 결합
                    const round1 = (val) => {
                        if (val === null || val === undefined || isNaN(val)) return null;
                        return Math.round(Number(val) * 10) / 10;
                    };

                    scoredList = list.map(item => {
                        const sid = String(item.id);
                        const ret = retentionMap[sid] || {};
                        const raw13 = ret.retention13Raw !== null && ret.retention13Raw !== undefined ? Number(ret.retention13Raw) : null;
                        const raw25 = ret.retention25Raw !== null && ret.retention25Raw !== undefined ? Number(ret.retention25Raw) : null;
                        const ret13 = round1(raw13);
                        const ret25 = round1(raw25);

                        const lapsed = Number(item.lapsed || 0);
                        const arrears = Number(item.arrears || 0);
                        const unpaid = Number(item.unpaid || 0);
                        const unsubmitted = Number(item.unsubmitted || 0);

                        let score = 0;
                        const reasons = [];

                        // 유지율 위험 (소수점 첫째자리까지 표시)
                        if (ret13 !== null && ret13 < 75) { score += 40; reasons.push(`13회차 유지율 극심(${ret13}%)`); }
                        else if (ret13 !== null && ret13 < 85) { score += 20; reasons.push(`13회차 유지율 저조(${ret13}%)`); }

                        if (ret25 !== null && ret25 < 70) { score += 20; reasons.push(`25회차 유지율 미달(${ret25}%)`); }

                        // 실효 위험
                        if (lapsed >= 5) { score += 40; reasons.push(`당월 실효 대량 발생(${lapsed}건)`); }
                        else if (lapsed >= 2) { score += 25; reasons.push(`당월 실효 발생(${lapsed}건)`); }
                        else if (lapsed === 1) { score += 10; reasons.push(`당월 실효 1건`); }

                        // 연체 위험
                        if (arrears >= 5) { score += 30; reasons.push(`당월 연체 누적(${arrears}건)`); }
                        else if (arrears >= 2) { score += 15; reasons.push(`연체 계약 주의(${arrears}건)`); }

                        // 확인서 미제출 (신계약 환수/수당 보류 직결)
                        if (unsubmitted >= 3) { score += 30; reasons.push(`신계약 확인서 다수 미제출(${unsubmitted}건)`); }
                        else if (unsubmitted >= 1) { score += 15; reasons.push(`확인서 미제출(${unsubmitted}건)`); }

                        // 미납
                        if (unpaid >= 4) { score += 15; reasons.push(`당월 미납 다수(${unpaid}건)`); }

                        let riskLevel = 'SAFE';
                        let badgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-200';
                        let badgeLabel = '🟢 양호';
                        if (score >= 60) {
                            riskLevel = 'DANGER';
                            badgeColor = 'bg-red-50 text-red-700 border-red-200';
                            badgeLabel = '🔴 고위험';
                        } else if (score >= 35) {
                            riskLevel = 'WARNING';
                            badgeColor = 'bg-orange-50 text-orange-700 border-orange-200';
                            badgeLabel = '🟠 경고';
                        } else if (score >= 15) {
                            riskLevel = 'CAUTION';
                            badgeColor = 'bg-amber-50 text-amber-700 border-amber-200';
                            badgeLabel = '🟡 주의';
                        }

                        const ret13Display = ret13 !== null ? `${ret13}%` : (ret.retention13 || '-');
                        const ret25Display = ret25 !== null ? `${ret25}%` : (ret.retention25 || '-');

                        return {
                            ...item,
                            ret13,
                            ret25,
                            ret13Str: ret13Display,
                            ret25Str: ret25Display,
                            score,
                            riskLevel,
                            badgeColor,
                            badgeLabel,
                            reasons
                        };
                    });

                    // 스코어 높은 순(위험도 높은 순)으로 정렬
                    scoredList.sort((a, b) => b.score - a.score);

                    // 캐시에 보관
                    state.data.anomalyAdminData = scoredList;
                    state.data.anomalyAdminMonth = state.currentMonth;
                }

                // 통계 카드 업데이트
                const totalEl = div.querySelector('#anomaly-stat-total');
                const dangerEl = div.querySelector('#anomaly-stat-danger');
                const warnEl = div.querySelector('#anomaly-stat-warning');
                const unsubEl = div.querySelector('#anomaly-stat-unsub');

                const dangerCount = scoredList.filter(x => x.riskLevel === 'DANGER').length;
                const warnCount = scoredList.filter(x => x.riskLevel === 'WARNING').length;
                const unsubCount = scoredList.filter(x => (x.unsubmitted || 0) > 0).length;

                if (totalEl) totalEl.innerText = `${scoredList.length}명`;
                if (dangerEl) dangerEl.innerText = `${dangerCount}명`;
                if (warnEl) warnEl.innerText = `${warnCount}명`;
                if (unsubEl) unsubEl.innerText = `${unsubCount}명`;

                // Gemini AI 종합 진단 브리핑 영역 렌더링
                const aiOverviewEl = div.querySelector('#anomaly-ai-overview-container');
                const overviewCacheKey = `ANOMALY_AI_OVERVIEW_${state.user.staffId}_${state.currentMonth}`;
                let overviewCachedText = sessionStorage.getItem(overviewCacheKey) || '';

                const renderAIOverview = (bodyContent, isRunning = false) => {
                    if (!aiOverviewEl) return;
                    aiOverviewEl.innerHTML = `
                    <div class="bg-gradient-to-br from-indigo-900 via-indigo-800 to-slate-900 rounded-2xl p-5 sm:p-6 text-white shadow-xl relative overflow-hidden">
                        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 pb-3 border-b border-indigo-700/60">
                            <div class="flex items-center gap-2.5">
                                <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-400 to-orange-500 flex items-center justify-center text-white shadow-md">
                                    <svg class="w-4 h-4 text-white animate-pulse" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>
                                </div>
                                <div>
                                    <h3 class="font-bold text-base text-white flex items-center gap-2">
                                        Gemini AI 종합 이상징후 진단 & 방어 전략
                                    </h3>
                                    <p class="text-xs text-indigo-200 mt-0.5">${scopeLabel} 위험군 집중 분석</p>
                                </div>
                            </div>
                            <div class="flex items-center gap-2 self-end sm:self-auto">
                                ${overviewCachedText ? `
                                <button id="anomaly-overview-copy" class="px-3 py-1.5 bg-white/10 hover:bg-white/20 border border-white/20 text-white rounded-xl text-xs font-semibold transition flex items-center gap-1 cursor-pointer">
                                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                                    <span>복사</span>
                                </button>` : ''}
                                <button id="anomaly-overview-run" ${isRunning ? 'disabled' : ''} class="px-3 py-1.5 bg-gradient-to-r from-amber-500 to-primary hover:from-amber-600 hover:to-primaryHover text-white rounded-xl text-xs font-bold shadow-md transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
                                    <svg class="w-3.5 h-3.5 ${isRunning ? 'animate-spin' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                                    <span>${overviewCachedText ? '다시 진단' : '✨ AI 심층 진단 실행'}</span>
                                </button>
                                ${overviewCachedText ? `
                                <button id="anomaly-overview-toggle" class="p-1.5 text-indigo-200 hover:text-white rounded-lg hover:bg-white/10 transition cursor-pointer" title="접기/펼치기">
                                    <svg id="anomaly-overview-toggle-icon" class="w-4 h-4 transform transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                                </button>` : ''}
                            </div>
                        </div>
                        <div id="anomaly-overview-body">
                            ${bodyContent}
                        </div>
                    </div>`;

                    const runBtn = aiOverviewEl.querySelector('#anomaly-overview-run');
                    const copyBtn = aiOverviewEl.querySelector('#anomaly-overview-copy');
                    const toggleBtn = aiOverviewEl.querySelector('#anomaly-overview-toggle');
                    const bodyEl = aiOverviewEl.querySelector('#anomaly-overview-body');
                    const toggleIcon = aiOverviewEl.querySelector('#anomaly-overview-toggle-icon');

                    if (runBtn) runBtn.onclick = () => executeAIOverview(true);
                    if (copyBtn) {
                        copyBtn.onclick = () => {
                            if (!overviewCachedText) return;
                            navigator.clipboard.writeText(overviewCachedText).then(() => {
                                copyBtn.innerHTML = `<svg class="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg><span>복사완료</span>`;
                                setTimeout(() => {
                                    copyBtn.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg><span>복사</span>`;
                                }, 2000);
                            });
                        };
                    }
                    if (toggleBtn && bodyEl && toggleIcon) {
                        toggleBtn.onclick = () => {
                            bodyEl.classList.toggle('hidden');
                            toggleIcon.classList.toggle('rotate-180');
                        };
                    }
                };

                const executeAIOverview = async (force = false) => {
                    if (!force && overviewCachedText) {
                        renderAIOverview(`<div class="whitespace-pre-wrap leading-relaxed font-medium text-slate-100 text-sm bg-white/10 p-4 rounded-xl border border-white/10 backdrop-blur-sm">${overviewCachedText}</div>`);
                        return;
                    }

                    renderAIOverview(`
                    <div class="flex flex-col items-center justify-center py-6 text-amber-300">
                        <div class="w-8 h-8 border-4 border-amber-400 border-t-transparent rounded-full animate-spin mb-2"></div>
                        <p class="text-sm font-bold text-white">Gemini AI가 ${scopeLabel}의 위험 패턴 및 환수 리스크를 종합 진단하고 있습니다...</p>
                        <p class="text-xs text-indigo-200 mt-1">잠시만 기다려주세요 (약 2~3초 소요)</p>
                    </div>`, true);

                    try {
                        const topRisks = scoredList.slice(0, 10).map(x => `${x.name}(${x.org1 || '-'}): [${x.badgeLabel}] ${x.reasons.join(', ')}`).join('\n');
                        const sysPrompt = `당신은 GA(보험대리점) 파트너스본부의 최고 감사 및 계약관리 리스크 통제 전문가입니다. 관리자를 위해 산하 파트너들의 유지율, 실효, 연체, 확인서 미제출 이상징후 데이터를 바탕으로 '마감 리스크 종합 방어 브리핑'을 반드시 한국어로만 작성하십시오. 영어, 사고 과정 원문 등은 일체 출력하지 마십시오. 환수 예방 및 유지율 관리를 위한 핵심 조치 사항을 한국어 개조식(Bullet points) 4~5줄로 전문적이고 강력하게 제시하십시오.`;
                        const usrPrompt = `분석 대상: ${scopeLabel}, 마감월: ${state.currentMonth}\n점검인원: ${scoredList.length}명, 고위험: ${dangerCount}명, 경고: ${warnCount}명, 확인서 미제출 발생: ${unsubCount}명\n\n[주요 관리 대상 파트너 및 리스크 징후]\n${topRisks}\n\n위 데이터를 분석하여 마감 전 시급히 조치해야 할 실무 지침과 환수 방어 가이드를 오직 자연스러운 한국어로만 작성해줘.`;

                        const res = await callGeminiAI(sysPrompt, usrPrompt);
                        overviewCachedText = res || '진단 결과를 생성하지 못했습니다.';
                        sessionStorage.setItem(overviewCacheKey, overviewCachedText);

                        const formatAnomalyHtml = (txt) => {
                            const lines = txt.split('\n').filter(l => l.trim().length > 0);
                            return lines.map(line => {
                                let trimmed = line.trim();
                                // 볼드 마크다운 파싱 (**텍스트** -> <strong>)
                                const parseInline = (s) => s.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-amber-200">$1</strong>');

                                // 제목/헤더 라인 (# 또는 [대괄호] 또는 **제목**)
                                if (trimmed.startsWith('#') || (trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('**[') && trimmed.endsWith(']**')) || (trimmed.startsWith('**') && trimmed.endsWith('**') && trimmed.length < 50)) {
                                    const cleanTitle = trimmed.replace(/^#+\s*/, '').replace(/^\*\*|\*\*$/g, '');
                                    return `<h4 class="text-sm font-extrabold text-amber-300 mt-2 mb-1 flex items-center gap-1.5"><span class="w-1.5 h-3.5 bg-amber-400 rounded-full inline-block"></span>${cleanTitle}</h4>`;
                                }
                                if (trimmed.startsWith('*') || trimmed.startsWith('-') || /^\d+\./.test(trimmed)) {
                                    const clean = trimmed.replace(/^[\*\-\d\.]+\s*/, '');
                                    return `<div class="flex items-start gap-2 text-xs sm:text-sm text-slate-100 py-1 leading-relaxed"><span class="text-amber-300 font-bold mt-0.5">•</span><span>${parseInline(clean)}</span></div>`;
                                }
                                return `<p class="text-xs sm:text-sm text-slate-100 py-1 leading-relaxed">${parseInline(trimmed)}</p>`;
                            }).join('');
                        };

                        renderAIOverview(`<div class="leading-relaxed font-medium bg-white/10 p-4 sm:p-5 rounded-xl border border-white/10 backdrop-blur-sm space-y-1">${formatAnomalyHtml(overviewCachedText)}</div>`);
                    } catch (err) {
                        console.error('executeAIOverview error', err);
                        renderAIOverview(`<div class="p-4 bg-red-900/50 text-red-200 rounded-xl text-sm font-medium border border-red-500/40">AI 진단 오류: ${err.message || err.toString()}</div>`);
                    }
                };

                if (overviewCachedText) {
                    executeAIOverview(false);
                } else {
                    renderAIOverview(`
                    <div class="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white/5 p-4 rounded-xl border border-white/10">
                        <p class="text-sm text-indigo-100 font-medium">
                            고위험군 파트너 ${dangerCount}명을 포함하여 산하 인원의 계약관리 리스크를 AI로 심층 분석합니다.
                        </p>
                        <span class="text-xs text-amber-300 font-semibold">오른쪽 위의 [✨ AI 심층 진단 실행] 버튼을 눌러주세요.</span>
                    </div>`);
                }

                // 리스트 렌더링 함수
                let currentFilter = 'ALL';
                const container = div.querySelector('#anomalyListContainer');

                const renderPartnerCards = () => {
                    const searchVal = (div.querySelector('#anomalySearch')?.value || '').trim().toLowerCase();
                    let filtered = scoredList.filter(item => {
                        const matchText = item.name.toLowerCase().includes(searchVal) || String(item.id).includes(searchVal);
                        if (!matchText) return false;
                        if (currentFilter === 'ALL') return true;
                        return item.riskLevel === currentFilter;
                    });

                    if (filtered.length === 0) {
                        container.innerHTML = `<div class="col-span-full bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center text-gray-500">해당 조건의 파트너 이상징후 내역이 없습니다.</div>`;
                        return;
                    }

                    container.innerHTML = filtered.map(item => `
                    <div class="bg-white rounded-2xl shadow-sm hover:shadow-lg transition-all duration-300 p-5 border border-gray-100 flex flex-col justify-between group relative">
                        <div>
                            <div class="flex justify-between items-start mb-3 border-b border-gray-50 pb-3">
                                <div>
                                    <div class="flex items-center gap-2">
                                        <h3 class="font-bold text-lg text-gray-900">${item.name}</h3>
                                        <span class="text-xs text-gray-400 font-mono">(${item.id})</span>
                                        ${item.org1 ? `<span class="text-[11px] font-normal text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">${item.org1}</span>` : ''}
                                    </div>
                                    <p class="text-xs text-gray-400 mt-0.5">리스크 위험 점수: <span class="font-bold text-gray-700">${item.score}점</span></p>
                                </div>
                                <span class="px-2.5 py-1 text-xs font-bold rounded-full border ${item.badgeColor} shadow-xs whitespace-nowrap">
                                    ${item.badgeLabel}
                                </span>
                            </div>

                            <!-- 핵심 지표 4분할 그리드 -->
                            <div class="grid grid-cols-4 gap-1.5 text-center mb-3">
                                <div class="bg-gray-50 p-2 rounded-xl border border-gray-100">
                                    <p class="text-[10px] text-gray-400 font-bold uppercase mb-0.5">13회차</p>
                                    <p class="text-xs sm:text-sm font-extrabold ${item.ret13 !== null && item.ret13 < 85 ? 'text-red-500' : 'text-gray-800'}">${item.ret13Str}</p>
                                </div>
                                <div class="bg-gray-50 p-2 rounded-xl border border-gray-100">
                                    <p class="text-[10px] text-gray-400 font-bold uppercase mb-0.5">당월실효</p>
                                    <p class="text-xs sm:text-sm font-extrabold ${item.lapsed > 0 ? 'text-red-500' : 'text-gray-400'}">${item.lapsed}건</p>
                                </div>
                                <div class="bg-gray-50 p-2 rounded-xl border border-gray-100">
                                    <p class="text-[10px] text-gray-400 font-bold uppercase mb-0.5">당월연체</p>
                                    <p class="text-xs sm:text-sm font-extrabold ${item.arrears > 0 ? 'text-orange-500' : 'text-gray-400'}">${item.arrears}건</p>
                                </div>
                                <div class="bg-gray-50 p-2 rounded-xl border border-gray-100">
                                    <p class="text-[10px] text-gray-400 font-bold uppercase mb-0.5">미제출</p>
                                    <p class="text-xs sm:text-sm font-extrabold ${item.unsubmitted > 0 ? 'text-purple-600' : 'text-gray-400'}">${item.unsubmitted}건</p>
                                </div>
                            </div>

                            <!-- 주요 감지 징후 사유 태그 -->
                            <div class="mb-4 min-h-[38px]">
                                ${item.reasons.length > 0 ? `
                                <div class="flex flex-wrap gap-1">
                                    ${item.reasons.map(r => `<span class="px-2 py-0.5 text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200/60 rounded-md">⚠️ ${r}</span>`).join('')}
                                </div>` : `<p class="text-xs text-emerald-600 font-medium py-1">특별한 계약관리 이상징후가 감지되지 않았습니다.</p>`}
                            </div>
                        </div>

                        <!-- 개별 AI 코칭 가이드 영역 -->
                        <div class="pt-3 border-t border-gray-100">
                            <div id="ai-partner-guide-${item.id}" class="hidden mb-3 p-3 bg-indigo-50/70 border border-indigo-100 rounded-xl text-xs text-gray-700 leading-relaxed font-medium"></div>
                            <button onclick="window.generatePartnerAICoaching('${item.id}', '${item.name}', '${item.org1 || ''}', '${item.badgeLabel}', '${item.reasons.join(', ')}', '${item.ret13Str}', ${item.lapsed}, ${item.arrears}, ${item.unsubmitted})" class="w-full py-2 bg-indigo-50 hover:bg-indigo-100 active:bg-indigo-200 text-indigo-700 border border-indigo-200 font-bold text-xs rounded-xl shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer">
                                <svg class="w-3.5 h-3.5 text-indigo-600" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>
                                <span>1:1 면담 코칭 가이드</span>
                            </button>
                        </div>
                    </div>`).join('');
                };

                // 필터 버튼 이벤트 연결
                div.querySelectorAll('.anomaly-filter-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        div.querySelectorAll('.anomaly-filter-btn').forEach(b => {
                            b.className = 'anomaly-filter-btn px-3 py-1.5 rounded-lg text-xs font-bold transition text-gray-500 hover:text-gray-800';
                        });
                        btn.className = 'anomaly-filter-btn px-3 py-1.5 rounded-lg text-xs font-bold transition bg-white shadow-sm text-indigo-600';
                        currentFilter = btn.getAttribute('data-risk');
                        renderPartnerCards();
                    });
                });

                const searchInput = div.querySelector('#anomalySearch');
                if (searchInput) searchInput.addEventListener('input', renderPartnerCards);

                // 초기 파트너 카드 렌더링
                renderPartnerCards();
            }, 10);

            return div;
        }

        // 개별 파트너 1:1 AI 면담 코칭 생성 전역 함수
        window.generatePartnerAICoaching = async function(id, name, org, riskLabel, reasons, ret13, lapsed, arrears, unsubmitted) {
            const box = document.getElementById(`ai-partner-guide-${id}`);
            if (!box) return;

            if (!box.classList.contains('hidden')) {
                box.classList.add('hidden');
                return;
            }

            box.classList.remove('hidden');
            box.innerHTML = `
            <div class="flex items-center gap-2 text-indigo-600 py-1">
                <div class="w-3.5 h-3.5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                <span>${name} 파트너 맞춤 면담 가이드 작성 중...</span>
            </div>`;

            try {
                const sysPrompt = `당신은 GA 파트너스본부의 관리자 1:1 면담 코칭 전문가입니다. 관리자가 특정 파트너와 면담할 때 바로 꺼내어 쓸 수 있는 '핵심 면담 화법 & 조치 솔루션'을 반드시 한국어로만 2~3줄로 매우 구체적이고 부드럽지만 단호하게 작성하십시오. 영어는 일체 사용하지 마십시오.`;
                const usrPrompt = `파트너: ${name}(${org}), 위험등급: ${riskLabel}, 감지사유: [${reasons}], 13회차유지율: ${ret13}, 실효: ${lapsed}건, 연체: ${arrears}건, 확인서미제출: ${unsubmitted}건. 관리자가 이 파트너에게 어떤 말로 대화를 시작하고 무엇을 즉시 조치시켜야 하는지 오직 한국어로만 작성해줘.`;

                const res = await callGeminiAI(sysPrompt, usrPrompt);
                box.innerHTML = `<div class="font-semibold text-indigo-900 mb-1 flex items-center gap-1"><span class="w-1.5 h-1.5 bg-indigo-500 rounded-full"></span> 1:1 면담 코칭 가이드</div><div class="whitespace-pre-wrap leading-relaxed">${res || '가이드를 생성하지 못했습니다.'}</div>`;
            } catch (err) {
                console.error(err);
                box.innerHTML = `<div class="text-red-500">생성 실패: ${err.message || err.toString()}</div>`;
            }
        };

        function createAdminView() {
            if (state.isLoading) return getSkeletonUI();
            if (state.adminTab === 'anomaly') return createAnomalyAdminView();

            const div = document.createElement('div');
            const dd = state.data.adminSummary || {};
            if (dd.error) { div.innerHTML = `<div class="p-4 bg-red-100 text-red-700 rounded-lg">데이터 로드 실패: ${dd.message}</div>`; return div; }

            const isBranch = state.user.role === '지사대표';

            const formatAdminMoney = (n) => {
                let num = Number(n || 0);
                if (num === 0) return `<span class="text-gray-400">-</span>`;
                return formatMoney(n);
            };

            div.innerHTML = `
            <div class="flex flex-col sm:flex-row justify-between mb-4 items-start sm:items-center gap-4">
                <div>
                    <h2 class="text-xl font-bold text-gray-800 tracking-tight">관리자 대시보드 (${state.currentMonth})</h2>
                    <p class="text-gray-500 text-sm mt-1">산하 멤버들의 시상금 현황을 조회합니다.</p>
                </div>
                <div class="flex space-x-1 bg-gray-100 p-1 rounded-lg self-start sm:self-center">
                    <button onclick="setAT('reward')" class="px-4 py-2 text-sm rounded-md transition duration-200 ${state.adminTab === 'reward' ? 'bg-white shadow-sm text-primary font-bold' : 'text-gray-500 hover:text-gray-700'}">시상금</button>
                    ${!isAdminAny() ? `<button onclick="setAT('recruitment')" class="px-4 py-2 text-sm rounded-md transition duration-200 ${state.adminTab === 'recruitment' ? 'bg-white shadow-sm text-primary font-bold' : 'text-gray-500 hover:text-gray-700'}">증원수당</button>` : ''}
                    <button onclick="setAT('anomaly')" class="px-4 py-2 text-sm rounded-md transition duration-200 ${state.adminTab === 'anomaly' ? 'bg-white shadow-sm text-indigo-600 font-bold' : 'text-gray-500 hover:text-gray-700'} flex items-center gap-1.5">
                        <svg class="w-4 h-4 text-amber-400" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>
                        <span>이상징후 탐지 AI</span>
                    </button>
                </div>
            </div>

            ${state.adminTab === 'reward' ? `
            <div class="mb-4 border-b border-gray-200">
                <nav class="-mb-px flex space-x-6">
                    <button onclick="setST('active')" class="${state.adminSubTab === 'active' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'} whitespace-nowrap py-3 border-b-2 font-medium text-sm transition">위촉자 (${dd.reward?.active?.length || 0})</button>
                    ${!isAdminAny() ? `<button onclick="setST('resigned')" class="${state.adminSubTab === 'resigned' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'} whitespace-nowrap py-3 border-b-2 font-medium text-sm transition">해촉자 (${dd.reward?.resigned?.length || 0})</button>` : ''}
                </nav>
            </div>` : ''}

            <div class="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div class="relative w-full max-w-md">
                    <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <svg class="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd" /></svg>
                    </div>
                    <!-- autoFocus doesn't work well directly in innerHTML replaced tags without extra care, setTimeout will handle focus -->
                    <input type="text" id="adminSearch" value="${state.adminSearch || ''}" placeholder="이름 또는 사번 검색" class="w-full pl-11 pr-4 py-3 border border-gray-200 rounded-xl bg-white shadow-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition text-sm">
                </div>
                ${(state.adminTab === 'reward' && state.adminSubTab === 'active' && state.user.role === '지사대표') ? `
                <div class="w-full sm:w-auto flex justify-end">
                    <button id="adminRecordTotalBtn" class="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-xl shadow-sm transition whitespace-nowrap flex items-center gap-1.5">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path></svg>
                        <span>개인별 총수당 기록</span>
                    </button>
                </div>
                ` : ''}
                ${(state.adminTab === 'recruitment' && state.user.role === '지사대표') ? `
                <div class="w-full sm:w-auto flex justify-end">
                    <button id="adminCalcRecruitmentBtn" class="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-xl shadow-sm transition whitespace-nowrap flex items-center gap-1.5">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
                        <span>마감월 증원수당 산출</span>
                    </button>
                </div>
                ` : ''}
            </div>

            <div id="adminListContainer"></div>
            `;

            const renderAdminList = () => {
                const container = div.querySelector('#adminListContainer');
                if (!container) return;

                let list = [];
                if (state.adminTab === 'reward') list = state.adminSubTab === 'active' ? (dd.reward?.active || []) : (dd.reward?.resigned || []);
                else list = dd.recruitment || [];

                const searchTerm = (state.adminSearch || '').trim().toLowerCase();
                if (searchTerm) {
                    list = list.filter(u => u.name.toLowerCase().includes(searchTerm) || String(u.id).includes(searchTerm));
                }

                const totalPages = Math.ceil(list.length / state.pageSize);
                const start = (state.adminPage - 1) * state.pageSize;
                const pageList = list.slice(start, start + state.pageSize);

                // Header Definitions
                const th = (t, extra = '', isComm = false) => `<th class="px-2 py-2 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider ${isComm ? 'bg-slate-50/80' : ''} min-w-[85px] ${extra}">${t}</th>`;
                const td = (v, c = '', onClickStr = '', isComm = false) => `<td class="px-2 py-2 text-right ${c} font-medium text-sm tabular-nums ${isComm ? 'bg-slate-50/50' : ''} ${onClickStr ? 'cursor-pointer hover:bg-blue-50/60' : ''} min-w-[85px]" ${onClickStr ? `onclick="${onClickStr}"` : ''}>${formatAdminMoney(v)}</td>`;

                const rows = pageList.map(u => {
                    let total = 0;
                    let cols = '';
                    if (state.adminTab === 'reward') {
                        const rewardTotal = (u.nlPay || 0) + (u.nlRef || 0) + (u.lPay || 0) + (u.lRef || 0) + (u.hqPay || 0) + (u.hqRef || 0) + (u.nlCorpPay || 0) + (u.nlCorpRef || 0) + (u.lCorpPay || 0) + (u.lCorpRef || 0);
                        const commTotal = isBranch ? ((u.nlCommPay || 0) + (u.nlCommRef || 0) + (u.lCommPay || 0) + (u.lCommRef || 0) + (u.mgrCommPay || 0) + (u.mgrCommRef || 0)) : 0;
                        total = rewardTotal + commTotal;
                        if (isBranch) {
                            cols += td(u.nlCommPay || 0, 'text-blue-600', `fetchAndShowCommissionAdminDetail('${u.id}','${u.name}','nl','pay')`, true);
                            cols += td(u.nlCommRef || 0, 'text-red-500 border-r border-gray-200', `fetchAndShowCommissionAdminDetail('${u.id}','${u.name}','nl','refund')`, true);
                            cols += td(u.lCommPay || 0, 'text-blue-600', `fetchAndShowCommissionAdminDetail('${u.id}','${u.name}','l','pay')`, true);
                            cols += td(u.lCommRef || 0, 'text-red-500 border-r border-gray-200', `fetchAndShowCommissionAdminDetail('${u.id}','${u.name}','l','refund')`, true);
                            cols += td(u.mgrCommPay || 0, 'text-blue-600', `fetchAndShowCommissionAdminDetail('${u.id}','${u.name}','mgr','pay')`, true);
                            cols += td(u.mgrCommRef || 0, 'text-red-500 border-r border-gray-200', `fetchAndShowCommissionAdminDetail('${u.id}','${u.name}','mgr','refund')`, true);
                            cols += `<td class="px-2 py-2 text-right font-bold text-sm tabular-nums bg-amber-50/70 ${commTotal < 0 ? 'text-red-500' : 'text-amber-900'} border-r border-gray-200 min-w-[90px]">${formatAdminMoney(commTotal)}</td>`;
                        }
                        cols += td(u.nlPay || 0, 'text-blue-600', `fetchAndShowAdminDetail('${u.id}', '${u.name}', '손보 시상금', 'pay')`);
                        cols += td(u.nlRef || 0, 'text-red-500 border-r border-gray-200', `fetchAndShowAdminDetail('${u.id}', '${u.name}', '손보 시상금', 'refund')`);
                        cols += td(u.lPay || 0, 'text-blue-600', `fetchAndShowAdminDetail('${u.id}', '${u.name}', '생보 시상금', 'pay')`);
                        cols += td(u.lRef || 0, 'text-red-500 border-r border-gray-200', `fetchAndShowAdminDetail('${u.id}', '${u.name}', '생보 시상금', 'refund')`);
                        cols += td(u.hqPay || 0, 'text-blue-600', `fetchAndShowAdminDetail('${u.id}', '${u.name}', '본부 시상금', 'pay')`);
                        cols += td(u.hqRef || 0, 'text-red-500 border-r border-gray-200', `fetchAndShowAdminDetail('${u.id}', '${u.name}', '본부 시상금', 'refund')`);
                        if (isBranch) {
                            cols += td(u.nlCorpPay || 0, 'text-blue-600', `fetchAndShowAdminDetail('${u.id}', '${u.name}', '손보법인 시상금(개인)', 'pay')`);
                            cols += td(u.nlCorpRef || 0, 'text-red-500 border-r border-gray-200', `fetchAndShowAdminDetail('${u.id}', '${u.name}', '손보법인 시상금(개인)', 'refund')`);
                            cols += td(u.lCorpPay || 0, 'text-blue-600', `fetchAndShowAdminDetail('${u.id}', '${u.name}', '생보법인 시상금(개인)', 'pay')`);
                            cols += td(u.lCorpRef || 0, 'text-red-500 border-r border-gray-200', `fetchAndShowAdminDetail('${u.id}', '${u.name}', '생보법인 시상금(개인)', 'refund')`);
                        }
                        cols += `<td class="px-2 py-2 text-right font-bold text-sm tabular-nums bg-amber-50/70 ${rewardTotal < 0 ? 'text-red-500' : 'text-amber-900'} border-r border-gray-200 min-w-[90px]">${formatAdminMoney(rewardTotal)}</td>`;
                    } else {
                        total = (u.nlPay || 0) + (u.nlRef || 0) + (u.lPay || 0) + (u.lRef || 0);
                        cols = td(u.nlPay || 0, 'text-blue-600') + td(u.nlRef || 0, 'text-red-500 border-r border-gray-200') + td(u.lPay || 0, 'text-blue-600') + td(u.lRef || 0, 'text-red-500 border-r border-gray-200');
                    }
                    const dotColor = total === 0 ? 'bg-gray-400' : 'bg-primary/70';
                    const pcDot = `<div class="inline-block w-1.5 h-1.5 rounded-full ${dotColor} mr-2 align-middle"></div>`;
                    const nameContent = `${pcDot}${u.name}`;
                    const nameCell = state.adminTab === 'recruitment'
                        ? `<td class="min-w-[110px] w-[110px] max-w-[110px] px-4 py-2 font-semibold text-blue-600 text-center cursor-pointer hover:underline decoration-blue-300 underline-offset-4 sticky left-0 z-10 bg-white group-hover:bg-gray-100 transition shadow-[inset_-1px_0_0_0_#f3f4f6]" onclick="fetchAndShowOrgTree('${u.id}', '${u.name}')"><div class="flex items-center justify-center text-[13px]">${nameContent}</div></td>`
                        : `<td class="min-w-[110px] w-[110px] max-w-[110px] px-4 py-2 font-semibold text-gray-900 text-center sticky left-0 z-10 bg-white group-hover:bg-gray-100 transition shadow-[inset_-1px_0_0_0_#f3f4f6]"><div class="flex items-center justify-center text-[13px]">${nameContent}</div></td>`;
                    return { u, total, cols, nameCell };
                });

                let headerCols = '';
                if (state.adminTab === 'reward') {
                    if (isBranch) {
                        headerCols += `<th colspan="2" class="px-2 py-2 text-center text-xs font-bold text-slate-600 bg-slate-100 border-b border-slate-200">손보수수료</th>`;
                        headerCols += `<th colspan="2" class="px-2 py-2 text-center text-xs font-bold text-slate-600 bg-slate-100 border-b border-slate-200">생보수수료</th>`;
                        headerCols += `<th colspan="2" class="px-2 py-2 text-center text-xs font-bold text-slate-600 bg-slate-100 border-b border-slate-200 border-r border-gray-200">관리수수료</th>`;
                        headerCols += `<th rowspan="2" class="px-2 py-2 text-center text-xs font-bold text-amber-900 bg-amber-100/70 border-b border-amber-200 border-r border-gray-200 align-middle min-w-[90px]">수수료계</th>`;
                    }
                    headerCols += `<th colspan="2" class="px-2 py-2 text-center text-xs font-bold text-gray-600 bg-gray-50 border-b border-gray-200">손보시상</th>`;
                    headerCols += `<th colspan="2" class="px-2 py-2 text-center text-xs font-bold text-gray-600 bg-gray-50 border-b border-gray-200">생보시상</th>`;
                    headerCols += `<th colspan="2" class="px-2 py-2 text-center text-xs font-bold text-gray-600 bg-gray-50 border-b border-gray-200">본부시상</th>`;
                    if (isBranch) {
                        headerCols += `<th colspan="2" class="px-2 py-2 text-center text-xs font-bold text-gray-600 bg-gray-50 border-b border-gray-200">손보법인</th>`;
                        headerCols += `<th colspan="2" class="px-2 py-2 text-center text-xs font-bold text-gray-600 bg-gray-50 border-b border-gray-200">생보법인</th>`;
                    }
                    headerCols += `<th rowspan="2" class="px-2 py-2 text-center text-xs font-bold text-amber-900 bg-amber-100/70 border-b border-amber-200 border-r border-gray-200 align-middle min-w-[90px]">시상금계</th>`;
                } else {
                    headerCols += `<th colspan="2" class="px-2 py-2 text-center text-xs font-bold text-gray-600 bg-gray-100 border-b border-gray-200">손보증원</th>`;
                    headerCols += `<th colspan="2" class="px-2 py-2 text-center text-xs font-bold text-gray-600 bg-gray-100 border-b border-gray-200">생보증원</th>`;
                }

                let subHeaderCols = '';
                if (state.adminTab === 'reward') {
                    if (isBranch) {
                        subHeaderCols += th('지급', 'text-blue-600 border-r-0', true) + th('환수', 'text-red-500 border-r border-gray-200', true);
                        subHeaderCols += th('지급', 'text-blue-600 border-r-0', true) + th('환수', 'text-red-500 border-r border-gray-200', true);
                        subHeaderCols += th('지급', 'text-blue-600 border-r-0', true) + th('환수', 'text-red-500 border-r border-gray-200', true);
                    }
                    subHeaderCols += th('지급', 'text-blue-600') + th('환수', 'text-red-500 border-r border-gray-200');
                    subHeaderCols += th('지급', 'text-blue-600') + th('환수', 'text-red-500 border-r border-gray-200');
                    subHeaderCols += th('지급', 'text-blue-600') + th('환수', 'text-red-500 border-r border-gray-200');
                    if (isBranch) {
                        subHeaderCols += th('지급', 'text-blue-600') + th('환수', 'text-red-500 border-r border-gray-200');
                        subHeaderCols += th('지급', 'text-blue-600') + th('환수', 'text-red-500 border-r border-gray-200');
                    }
                } else {
                    subHeaderCols = th('지급', 'text-blue-600') + th('환수', 'text-red-500 border-r border-gray-200') + th('지급', 'text-blue-600') + th('환수', 'text-red-500 border-r border-gray-200');
                }

                const mobileCards = rows.map(({ u, total }) => {
                    const rewardTotal = (u.nlPay || 0) + (u.nlRef || 0) + (u.lPay || 0) + (u.lRef || 0) + (u.hqPay || 0) + (u.hqRef || 0) + (u.nlCorpPay || 0) + (u.nlCorpRef || 0) + (u.lCorpPay || 0) + (u.lCorpRef || 0);
                    const commTotal = isBranch ? ((u.nlCommPay || 0) + (u.nlCommRef || 0) + (u.lCommPay || 0) + (u.lCommRef || 0) + (u.mgrCommPay || 0) + (u.mgrCommRef || 0)) : 0;

                    const commRows = isBranch && state.adminTab === 'reward' ? `
                        <div class="grid grid-cols-3 gap-1 mt-2 pt-2 border-t border-blue-50">
                            <div class="text-center p-1.5 bg-blue-50/60 rounded-lg">
                                <p class="text-[9px] text-blue-700 font-bold mb-0.5">손보수수료</p>
                                <p class="text-xs font-bold ${(u.nlCommPay || 0) + (u.nlCommRef || 0) < 0 ? 'text-red-500' : 'text-blue-700'}">${formatAdminMoney((u.nlCommPay || 0) + (u.nlCommRef || 0))}</p>
                            </div>
                            <div class="text-center p-1.5 bg-indigo-50/60 rounded-lg">
                                <p class="text-[9px] text-indigo-700 font-bold mb-0.5">생보수수료</p>
                                <p class="text-xs font-bold ${(u.lCommPay || 0) + (u.lCommRef || 0) < 0 ? 'text-red-500' : 'text-indigo-700'}">${formatAdminMoney((u.lCommPay || 0) + (u.lCommRef || 0))}</p>
                            </div>
                            <div class="text-center p-1.5 bg-purple-50/60 rounded-lg">
                                <p class="text-[9px] text-purple-700 font-bold mb-0.5">관리수수료</p>
                                <p class="text-xs font-bold ${(u.mgrCommPay || 0) + (u.mgrCommRef || 0) < 0 ? 'text-red-500' : 'text-purple-700'}">${formatAdminMoney((u.mgrCommPay || 0) + (u.mgrCommRef || 0))}</p>
                            </div>
                        </div>
                        <div class="mt-1 p-1.5 bg-amber-50/80 rounded-lg flex justify-between items-center text-xs px-2.5">
                            <span class="text-[11px] font-bold text-amber-900">수수료계</span>
                            <span class="font-bold ${commTotal < 0 ? 'text-red-500' : 'text-amber-900'}">${formatAdminMoney(commTotal)}</span>
                        </div>` : '';

                    const dotColor = total === 0 ? 'bg-gray-400' : 'bg-primary/70';

                    return `
                    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                        <div class="flex justify-between items-center mb-3">
                            <div>
                                <h3 class="font-bold text-lg text-gray-900 flex items-center gap-2">
                                    <div class="w-1.5 h-1.5 rounded-full ${dotColor}"></div>
                                    ${u.name}
                                </h3>
                            </div>
                            <div class="text-right">
                                <p class="text-lg font-extrabold ${total < 0 ? 'text-red-500' : 'text-gray-900'}">${formatAdminMoney(total)}</p>
                            </div>
                        </div>
                        ${commRows}
                        ${state.adminTab === 'reward' ? `
                        <div class="grid grid-cols-3 gap-1 mt-2 pt-2 border-t border-gray-50">
                            <div class="text-center p-1.5 bg-gray-50 rounded-lg">
                                <p class="text-[9px] text-gray-500 font-bold mb-0.5">손보시상</p>
                                <p class="text-xs font-bold ${(u.nlPay || 0) + (u.nlRef || 0) < 0 ? 'text-red-500' : 'text-gray-700'}">${formatAdminMoney((u.nlPay || 0) + (u.nlRef || 0))}</p>
                            </div>
                            <div class="text-center p-1.5 bg-gray-50 rounded-lg">
                                <p class="text-[9px] text-gray-500 font-bold mb-0.5">생보시상</p>
                                <p class="text-xs font-bold ${(u.lPay || 0) + (u.lRef || 0) < 0 ? 'text-red-500' : 'text-gray-700'}">${formatAdminMoney((u.lPay || 0) + (u.lRef || 0))}</p>
                            </div>
                            <div class="text-center p-1.5 bg-gray-50 rounded-lg">
                                <p class="text-[9px] text-gray-500 font-bold mb-0.5">본부시상</p>
                                <p class="text-xs font-bold ${(u.hqPay || 0) + (u.hqRef || 0) < 0 ? 'text-red-500' : 'text-gray-700'}">${formatAdminMoney((u.hqPay || 0) + (u.hqRef || 0))}</p>
                            </div>
                        </div>
                        ${isBranch ? `
                        <div class="grid grid-cols-2 gap-1 mt-2 pt-2 border-t border-gray-50">
                            <div class="text-center p-1.5 bg-gray-50 rounded-lg">
                                <p class="text-[9px] text-gray-500 font-bold mb-0.5">손보법인</p>
                                <p class="text-xs font-bold ${(u.nlCorpPay || 0) + (u.nlCorpRef || 0) < 0 ? 'text-red-500' : 'text-gray-700'}">${formatAdminMoney((u.nlCorpPay || 0) + (u.nlCorpRef || 0))}</p>
                            </div>
                            <div class="text-center p-1.5 bg-gray-50 rounded-lg">
                                <p class="text-[9px] text-gray-500 font-bold mb-0.5">생보법인</p>
                                <p class="text-xs font-bold ${(u.lCorpPay || 0) + (u.lCorpRef || 0) < 0 ? 'text-red-500' : 'text-gray-700'}">${formatAdminMoney((u.lCorpPay || 0) + (u.lCorpRef || 0))}</p>
                            </div>
                        </div>` : ''}
                        <div class="mt-1 p-1.5 bg-amber-50/80 rounded-lg flex justify-between items-center text-xs px-2.5">
                            <span class="text-[11px] font-bold text-amber-900">시상금계</span>
                            <span class="font-bold ${rewardTotal < 0 ? 'text-red-500' : 'text-amber-900'}">${formatAdminMoney(rewardTotal)}</span>
                        </div>` : `
                        <div class="grid grid-cols-2 gap-1 mt-2 pt-2 border-t border-gray-50">
                            <div class="text-center p-1.5 bg-gray-50 rounded-lg">
                                <p class="text-[9px] text-gray-500 font-bold mb-0.5">손보증원</p>
                                <p class="text-xs font-bold ${(u.nlPay || 0) + (u.nlRef || 0) < 0 ? 'text-red-500' : 'text-gray-700'}">${formatAdminMoney((u.nlPay || 0) + (u.nlRef || 0))}</p>
                            </div>
                            <div class="text-center p-1.5 bg-gray-50 rounded-lg">
                                <p class="text-[9px] text-gray-500 font-bold mb-0.5">생보증원</p>
                                <p class="text-xs font-bold ${(u.lPay || 0) + (u.lRef || 0) < 0 ? 'text-red-500' : 'text-gray-700'}">${formatAdminMoney((u.lPay || 0) + (u.lRef || 0))}</p>
                            </div>
                        </div>`}
                    </div>`;
                }).join('');

                // 페이지 변경 함수 설정
                // To support calling setPage from inside the dynamically rendered string without triggering a full setPage render
                window._internalAdminPageSet = function (d) {
                    state.adminPage += d;
                    renderAdminList();
                };

                const pagination = `<div class="flex justify-center items-center mt-6 space-x-2">
                     <button ${state.adminPage === 1 ? 'disabled' : ''} onclick="_internalAdminPageSet(-1)" class="w-10 h-10 flex items-center justify-center bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition text-gray-600"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg></button>
                     <span class="px-4 py-2 text-sm text-gray-600 font-medium bg-gray-100 rounded-lg">${state.adminPage} / ${totalPages || 1}</span>
                     <button ${state.adminPage >= totalPages ? 'disabled' : ''} onclick="_internalAdminPageSet(1)" class="w-10 h-10 flex items-center justify-center bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition text-gray-600"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg></button>
                 </div>`;

                container.innerHTML = `
                <!-- 데스크탑 테이블 -->
                <div class="hidden md:block bg-white shadow-sm border border-gray-200 rounded-xl overflow-hidden">
                    <div class="overflow-x-auto">
                    <table class="w-full divide-y divide-gray-200 whitespace-nowrap text-sm" style="min-width: ${isBranch ? '1750px' : '1000px'};">
                        <thead class="bg-gray-50">
                         <tr>
                           <th rowspan="2" class="min-w-[110px] w-[110px] max-w-[110px] px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider align-middle border-b border-gray-200 sticky left-0 z-20 bg-gray-50 shadow-[inset_-1px_0_0_0_#e5e7eb]">이름</th>
                           ${headerCols}
                           <th rowspan="2" class="min-w-[110px] w-[110px] max-w-[110px] px-4 py-3 text-right font-bold text-gray-800 bg-gray-100/50 align-middle border-b border-gray-200">합계</th>
                         </tr>
                         <tr>${subHeaderCols}</tr>
                       </thead>
                       <tbody class="divide-y divide-gray-200 bg-white">
                          ${rows.map(({ cols, nameCell, total }) =>
                    `<tr class="group hover:bg-gray-100 transition">${nameCell}${cols}<td class="min-w-[110px] w-[110px] max-w-[110px] px-4 py-2 text-right font-bold ${total < 0 ? 'text-red-500' : 'text-gray-900'} bg-gray-50/30 text-[13px] group-hover:bg-gray-100/50 transition">${formatAdminMoney(total)}</td></tr>`
                ).join('')}
                       </tbody>
                    </table>
                    </div>
                    ${rows.length === 0 ? '<div class="p-12 text-center text-gray-400">데이터가 없습니다.</div>' : ''}
                </div>

                <!-- 모바일 카드 뷰 -->
                <div class="md:hidden flex flex-col gap-3">
                    ${mobileCards.length > 0 ? mobileCards : '<div class="p-8 text-center text-gray-400">데이터가 없습니다.</div>'}
                </div>

                ${pagination}`;
            };

            setTimeout(() => {
                const searchInput = div.querySelector('#adminSearch');
                if (searchInput) {
                    if (state.adminSearch) {
                        searchInput.focus();
                        const val = searchInput.value;
                        searchInput.value = '';
                        searchInput.value = val;
                    }

                    searchInput.addEventListener('input', (e) => {
                        state.adminSearch = e.target.value;
                        state.adminPage = 1;
                        renderAdminList();
                    });
                }

                const recordBtn = div.querySelector('#adminRecordTotalBtn');
                if (recordBtn) {
                    recordBtn.addEventListener('click', async () => {
                        if (!confirm(`현재 조회된 마감월(${state.currentMonth})의 위촉자 개인별 총수당을 개인별월별총수당_DB 파일에 기록하시겠습니까?\n(사번이 존재하는 경우 마감월 값만 업데이트됩니다.)`)) {
                            return;
                        }
                        
                        recordBtn.disabled = true;
                        const originalHtml = recordBtn.innerHTML;
                        recordBtn.innerHTML = `
                            <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg><span>기록 중...</span>`;
                        
                        try {
                            const res = await callApi('recordMonthlyTotalAllowance', state.user.staffId, state.currentMonth);
                            if (res.error || !res.success) {
                                alert(res.message || '기록 중 오류가 발생했습니다.');
                            } else {
                                alert(res.message || '성공적으로 기록되었습니다.');
                            }
                        } catch (e) {
                            alert('서버와의 통신에 실패했습니다: ' + e.toString());
                        } finally {
                            recordBtn.disabled = false;
                            recordBtn.innerHTML = originalHtml;
                        }
                    });
                }

                const calcRecBtn = div.querySelector('#adminCalcRecruitmentBtn');
                if (calcRecBtn) {
                    calcRecBtn.addEventListener('click', async () => {
                        if (!confirm(`현재 조회된 마감월(${state.currentMonth})의 증원수당을 산출하여 수수료_DB 파일에 저장하시겠습니까?\n(기존 동일 마감월 데이터는 덮어씌워집니다.)`)) {
                            return;
                        }
                        
                        calcRecBtn.disabled = true;
                        const originalHtml = calcRecBtn.innerHTML;
                        calcRecBtn.innerHTML = `
                            <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg><span>산출 중...</span>`;
                        
                        try {
                            const res = await callApi('calculateMonthlyRecruitmentAllowance', state.user.staffId, state.currentMonth);
                            if (res.error) {
                                alert(res.message || '산출 중 오류가 발생했습니다.');
                            } else {
                                alert(res.message || '증원수당이 성공적으로 산출 및 저장되었습니다.');
                                state.isLoading = true;
                                render();
                                try {
                                    const d = await callApi('getAdminSummary', state.currentMonth, state.user.staffId);
                                    state.data.adminSummary = d;
                                } catch (err) {
                                    console.error(err);
                                } finally {
                                    state.isLoading = false;
                                    render();
                                }
                            }
                        } catch (e) {
                            alert('서버와의 통신에 실패했습니다: ' + e.toString());
                        } finally {
                            calcRecBtn.disabled = false;
                            calcRecBtn.innerHTML = originalHtml;
                        }
                    });
                }
            }, 0);

            // 최초 리스트 렌더링
            setTimeout(renderAdminList, 0);

            return div;
        };
        function setAT(t) { state.adminTab = t; state.adminPage = 1; state.adminSearch = ''; render(); }
        function setST(t) { state.adminSubTab = t; state.adminPage = 1; render(); }
        function setPage(d) { state.adminPage += d; render(); }
        function setLapseAT(t) { state.lapseAdminTab = t; render(); }
        function setBranchSubView(v) { state.branchSubView = v; render(); }
        function setNewContractTab(t) {
            state.newContractTab = t;
            const dataKey = t === 'nl' ? 'newContractNl' : 'newContractL';
            if (!state.data[dataKey] || state.data[dataKey + '_month'] !== state.currentMonth) {
                state.data.newContractNl = null; state.data.newContractL = null; // clear both for re-fetch
            }
            render();
        }

        function createLapseAdminView() {
            if (state.isLoading) return getSkeletonUI();
            const div = document.createElement('div');
            state.lapseAdminTab = state.lapseAdminTab || 'active';
            state.lapseBaseType = state.lapseBaseType || 'recruiter';
            state.lapseSortOrder = state.lapseSortOrder || 'highestLapsed';
            state.lapseOrgFilter = state.lapseOrgFilter || '전체';

            div.innerHTML = `
                <div class="mb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                        <h2 class="text-xl font-bold text-gray-800 tracking-tight">실효연체관리${state.lapseData.lapsedDate ? ' <span class="text-sm font-normal text-gray-400">(' + formatLapseDate(state.lapseData.lapsedDate) + ' 기준)</span>' : ''}</h2>
                        <p class="text-gray-500 text-sm mt-1">선택 기준별 당월 실효 및 연체계약 현황을 조회합니다.</p>
                    </div>
                    <div class="flex flex-col sm:flex-row items-end sm:items-center gap-2 self-start sm:self-center w-full sm:w-auto">
                        <div class="flex items-center gap-2 bg-indigo-50/50 p-1.5 rounded-xl border border-indigo-100/50 w-full sm:w-auto">
                            <label class="flex items-center gap-1.5 px-2 cursor-pointer group">
                                <input type="checkbox" id="includeUnpaidPrint" class="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 transition cursor-pointer">
                                <span class="text-xs font-bold text-indigo-700 group-hover:text-indigo-900 transition whitespace-nowrap">미납 포함</span>
                            </label>
                            <div class="w-px h-4 bg-indigo-200 hidden sm:block"></div>
                            <button onclick="printAllLapseAdminDetails()" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow-sm transition flex items-center justify-center gap-2 whitespace-nowrap text-sm flex-1 sm:flex-none">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
                                프린트
                            </button>
                            <div class="relative group flex-1 sm:flex-none">
                                <button onclick="downloadAllLapseAdminExcel()" class="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg shadow-sm transition flex items-center justify-center gap-2 whitespace-nowrap text-sm">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                                    엑셀저장
                                </button>
                                <div class="absolute top-full left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-50 w-max px-3.5 py-2 bg-gray-900/95 text-white text-xs rounded-lg shadow-2xl backdrop-blur-sm pointer-events-none transition duration-200 text-center leading-relaxed whitespace-nowrap">
                                    <div class="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-gray-900/95"></div>
                                    <div>위촉자와 해촉자를 한 시트에 저장하고,</div>
                                    <div>실효, 연체 계약만 저장합니다.</div>
                                </div>
                            </div>
                        </div>
                        <div class="flex space-x-1 bg-gray-100 p-1 rounded-lg w-full sm:w-auto justify-center">
                            <button onclick="setLapseBaseType('recruiter')" class="flex-1 sm:flex-none px-3 py-1.5 text-xs sm:text-sm rounded-md transition duration-200 ${state.lapseBaseType === 'recruiter' ? 'bg-white shadow-sm text-primary font-bold' : 'text-gray-500 hover:text-gray-700'}">모집인 기준</button>
                            <button onclick="setLapseBaseType('collector')" class="flex-1 sm:flex-none px-3 py-1.5 text-xs sm:text-sm rounded-md transition duration-200 ${state.lapseBaseType === 'collector' ? 'bg-white shadow-sm text-primary font-bold' : 'text-gray-500 hover:text-gray-700'}">수금인 기준</button>
                        </div>
                    </div>
                </div>
                
                <div class="mb-4 border-b border-gray-200">
                    <nav class="-mb-px flex space-x-6">
                        <button onclick="setLapseAT('active')" class="${state.lapseAdminTab === 'active' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'} whitespace-nowrap py-3 border-b-2 font-medium text-sm transition">위촉자 <span id="lapseActiveCount"></span></button>
                        <button onclick="setLapseAT('resigned')" class="${state.lapseAdminTab === 'resigned' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'} whitespace-nowrap py-3 border-b-2 font-medium text-sm transition">해촉자 <span id="lapseResignedCount"></span></button>
                    </nav>
                </div>

                <div class="mb-6 flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
                    <div class="relative w-full md:max-w-xs flex-grow">
                        <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                            <svg class="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd" /></svg>
                        </div>
                        <input type="text" id="lapseAdminSearch" placeholder="${state.lapseBaseType === 'recruiter' ? '모집인' : '수금인'} 이름 또는 사번 검색" class="w-full pl-11 pr-4 py-2.5 border border-gray-200 rounded-xl bg-white shadow-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition text-sm">
                    </div>
                    
                    <div class="flex flex-wrap items-center gap-2">
                        <!-- 소속 필터 드롭박스 -->
                        <div class="relative min-w-[130px] flex-1 sm:flex-none">
                            <select id="lapseAdminOrgFilter" class="w-full appearance-none pl-3 pr-8 py-2.5 border border-gray-200 rounded-xl bg-white shadow-sm text-gray-700 text-sm font-medium focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition cursor-pointer">
                                <option value="전체">전체</option>
                            </select>
                            <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                                <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                            </div>
                        </div>

                        <!-- 정렬 세그먼트 컨트롤 (이미지2 스타일) -->
                        <div class="flex items-center gap-1.5">
                            <label class="text-[11px] font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap flex items-center gap-1">
                                <span class="w-1.5 h-3 bg-primary rounded-sm inline-block"></span>
                                정렬
                            </label>
                            <div id="lapseSortRadioGroup" class="inline-flex flex-wrap p-1 bg-gray-200/60 rounded-xl gap-0.5 border border-gray-200/80">
                                <label class="cursor-pointer select-none">
                                    <input type="radio" name="lapseSortRadio" value="id" ${state.lapseSortOrder === 'id' ? 'checked' : ''} class="sr-only peer">
                                    <span class="px-2.5 py-1 rounded-lg text-xs font-bold transition-all inline-block text-gray-600 hover:text-gray-900 peer-checked:bg-primary peer-checked:text-white peer-checked:shadow-sm">사번</span>
                                </label>
                                <label class="cursor-pointer select-none">
                                    <input type="radio" name="lapseSortRadio" value="highestLapsed" ${state.lapseSortOrder === 'highestLapsed' ? 'checked' : ''} class="sr-only peer">
                                    <span class="px-2.5 py-1 rounded-lg text-xs font-bold transition-all inline-block text-gray-600 hover:text-gray-900 peer-checked:bg-primary peer-checked:text-white peer-checked:shadow-sm">실효</span>
                                </label>
                                <label class="cursor-pointer select-none">
                                    <input type="radio" name="lapseSortRadio" value="highestArrears" ${state.lapseSortOrder === 'highestArrears' ? 'checked' : ''} class="sr-only peer">
                                    <span class="px-2.5 py-1 rounded-lg text-xs font-bold transition-all inline-block text-gray-600 hover:text-gray-900 peer-checked:bg-primary peer-checked:text-white peer-checked:shadow-sm">연체</span>
                                </label>
                                <label class="cursor-pointer select-none">
                                    <input type="radio" name="lapseSortRadio" value="highestUnpaid" ${state.lapseSortOrder === 'highestUnpaid' ? 'checked' : ''} class="sr-only peer">
                                    <span class="px-2.5 py-1 rounded-lg text-xs font-bold transition-all inline-block text-gray-600 hover:text-gray-900 peer-checked:bg-primary peer-checked:text-white peer-checked:shadow-sm">미납</span>
                                </label>
                                <label class="cursor-pointer select-none">
                                    <input type="radio" name="lapseSortRadio" value="highestUnsubmitted" ${state.lapseSortOrder === 'highestUnsubmitted' ? 'checked' : ''} class="sr-only peer">
                                    <span class="px-2.5 py-1 rounded-lg text-xs font-bold transition-all inline-block text-gray-600 hover:text-gray-900 peer-checked:bg-primary peer-checked:text-white peer-checked:shadow-sm">미제출</span>
                                </label>
                            </div>
                        </div>
                    </div>
                </div>

                <div id="lapseAdminList" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    <div class="col-span-full flex items-center justify-center h-40">
                         <div class="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                    </div>
                </div>
            `;

            const renderCards = (list, filterText = '', sortOrder = state.lapseSortOrder, orgFilter = state.lapseOrgFilter) => {
                const container = div.querySelector('#lapseAdminList');
                if (!list) return;

                let baseList = list.slice();
                if (orgFilter && orgFilter !== '전체') {
                    baseList = baseList.filter(x => (x.org1 || '').trim() === orgFilter);
                }

                const activeList = baseList.filter(x => !x.isResigned);
                const resignedList = baseList.filter(x => x.isResigned);

                const countActive = div.querySelector('#lapseActiveCount');
                if (countActive) countActive.innerText = '(' + activeList.length + ')';
                const countResigned = div.querySelector('#lapseResignedCount');
                if (countResigned) countResigned.innerText = '(' + resignedList.length + ')';

                let currentList = state.lapseAdminTab === 'active' ? activeList.slice() : resignedList.slice();

                if (sortOrder === 'highestLapsed') {
                    currentList.sort((a, b) => ((b.lapsed || 0) - (a.lapsed || 0)) || String(a.id).localeCompare(String(b.id)));
                } else if (sortOrder === 'highestArrears') {
                    currentList.sort((a, b) => ((b.arrears || 0) - (a.arrears || 0)) || String(a.id).localeCompare(String(b.id)));
                } else if (sortOrder === 'highestUnpaid') {
                    currentList.sort((a, b) => ((b.unpaid || 0) - (a.unpaid || 0)) || String(a.id).localeCompare(String(b.id)));
                } else if (sortOrder === 'highestUnsubmitted') {
                    currentList.sort((a, b) => ((b.unsubmitted || 0) - (a.unsubmitted || 0)) || String(a.id).localeCompare(String(b.id)));
                } else { // 'id' (사번순)
                    currentList.sort((a, b) => String(a.id).localeCompare(String(b.id)));
                }

                const fText = (filterText || '').toLowerCase();
                const filtered = currentList.filter(x => x.name.toLowerCase().includes(fText) || String(x.id).includes(fText));

                if (filtered.length === 0) {
                    container.innerHTML = `<div class="col-span-full bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center text-gray-500">조회된 내역이 없습니다.</div>`;
                    return;
                }

                container.innerHTML = filtered.map(item => `
                    <div class="bg-white rounded-2xl shadow-sm hover:shadow-lg transition-all duration-300 p-5 border border-gray-100 flex flex-col group">
                         <div class="flex justify-between items-center mb-3 border-b border-gray-50 pb-2.5">
                             <div>
                                 <h3 class="font-bold text-lg text-gray-900 flex items-center gap-2">
                                     <div class="w-1.5 h-1.5 rounded-full bg-primary/70"></div>
                                     ${item.name} <span class="text-xs text-gray-400 font-normal">(${item.id})</span>
                                     ${item.org1 ? `<span class="text-[11px] font-normal text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">${item.org1}</span>` : ''}
                                 </h3>
                             </div>
                             <div class="text-right flex flex-col items-end justify-center">
                                 <p class="text-[10px] text-gray-400 font-bold mb-0.5">13회차유지율</p>
                                 <span class="text-sm font-extrabold ${(item.retentionRate && item.retentionRate !== '데이터 없음' && item.retentionRate !== '-')
                        ? (parseFloat(item.retentionRate) >= 90 ? 'text-blue-500' : 'text-red-500')
                        : 'text-gray-400 text-xs'
                    }">
                                     ${item.retentionRate || '-'}
                                 </span>
                             </div>
                         </div>
                         <div class="grid grid-cols-4 gap-1.5 text-center">
                            <div class="cursor-pointer hover:bg-red-50 p-1.5 rounded-xl transition border border-transparent hover:border-red-100" onclick="fetchAndShowLapseAdminDetail('${item.id}', '${item.name}', 'lapsed')">
                                <p class="text-[10px] text-gray-400 font-bold uppercase mb-1 whitespace-nowrap">당월 실효</p>
                                <p class="text-base font-extrabold ${item.lapsed > 0 ? 'text-red-500' : 'text-gray-300'}">${item.lapsed}<span class="text-[9px] font-medium ml-0.5">건</span></p>
                            </div>
                            <div class="cursor-pointer hover:bg-orange-50 p-1.5 rounded-xl transition border border-transparent hover:border-orange-100" onclick="fetchAndShowLapseAdminDetail('${item.id}', '${item.name}', 'arrears')">
                                <p class="text-[10px] text-gray-400 font-bold uppercase mb-1 whitespace-nowrap">당월 연체</p>
                                <p class="text-base font-extrabold ${item.arrears > 0 ? 'text-orange-500' : 'text-gray-300'}">${item.arrears}<span class="text-[9px] font-medium ml-0.5">건</span></p>
                            </div>
                            <div class="cursor-pointer hover:bg-blue-50 p-1.5 rounded-xl transition border border-transparent hover:border-blue-100" onclick="fetchAndShowLapseAdminDetail('${item.id}', '${item.name}', 'unpaid')">
                                <p class="text-[10px] text-gray-400 font-bold uppercase mb-1 whitespace-nowrap">당월 미납</p>
                                <p class="text-base font-extrabold ${item.unpaid > 0 ? 'text-blue-600' : 'text-gray-300'}">${item.unpaid || 0}<span class="text-[9px] font-medium ml-0.5">건</span></p>
                            </div>
                            <div class="cursor-pointer hover:bg-purple-50 p-1.5 rounded-xl transition border border-transparent hover:border-purple-100" onclick="fetchAndShowLapseAdminDetail('${item.id}', '${item.name}', 'unsubmitted')">
                                <p class="text-[10px] text-gray-400 font-bold uppercase mb-1 whitespace-nowrap">미제출</p>
                                <p class="text-base font-extrabold ${item.unsubmitted > 0 ? 'text-purple-600' : 'text-gray-300'}">${item.unsubmitted || 0}<span class="text-[9px] font-medium ml-0.5">건</span></p>
                            </div>
                         </div>
                    </div>
                `).join('');
            };

            const populateOrgFilter = (list) => {
                const orgSelect = div.querySelector('#lapseAdminOrgFilter');
                if (!orgSelect || !list) return;
                const orgSet = new Set();
                list.forEach(item => {
                    const o = (item.org1 || '').trim();
                    if (o && o !== '-' && o !== 'undefined') orgSet.add(o);
                });
                const sortedOrgs = Array.from(orgSet).sort((a, b) => a.localeCompare(b, 'ko'));
                
                orgSelect.innerHTML = `<option value="전체">전체</option>` + sortedOrgs.map(o => `<option value="${o}" ${state.lapseOrgFilter === o ? 'selected' : ''}>${o}</option>`).join('');
            };

            setTimeout(async () => {
                if (!state.data.lapseAdminSummary || state.data.lapseAdminSummaryType !== state.lapseBaseType) {
                    const res = await callApi('getAdminLapseArrearsSummary', state.user.staffId, state.lapseBaseType);
                    if (res.error || !res.success) {
                        div.querySelector('#lapseAdminList').innerHTML = `<div class="col-span-full p-8 text-center text-red-500 bg-red-50 rounded-2xl border border-red-100">데이터를 불러오지 못했습니다.<br><span class="text-sm">${res.message || '네트워크 오류'}</span></div>`;
                        return;
                    }
                    state.data.lapseAdminSummary = res.list || [];
                    state.data.lapseAdminSummaryType = state.lapseBaseType;
                }

                populateOrgFilter(state.data.lapseAdminSummary);

                const searchInput = div.querySelector('#lapseAdminSearch');
                const orgSelect = div.querySelector('#lapseAdminOrgFilter');
                const sortRadios = div.querySelectorAll('input[name="lapseSortRadio"]');

                const updateView = () => {
                    renderCards(state.data.lapseAdminSummary, searchInput.value.trim(), state.lapseSortOrder, state.lapseOrgFilter);
                };

                searchInput.addEventListener('input', updateView);
                sortRadios.forEach(r => {
                    r.addEventListener('change', (e) => {
                        if (e.target.checked) {
                            state.lapseSortOrder = e.target.value;
                            updateView();
                        }
                    });
                });
                orgSelect.addEventListener('change', (e) => {
                    state.lapseOrgFilter = e.target.value;
                    updateView();
                });

                updateView();

                // [NEW] 실효연체관리 개인별 상세 데이터 백그라운드 사전 캐싱(Prefetch)
                if (state.data.lapseAdminSummary && state.data.lapseAdminSummary.length > 0) {
                    const queue = [...state.data.lapseAdminSummary];
                    const baseType = state.lapseBaseType;
                    
                    const prefetchNext = async () => {
                        if (queue.length === 0) return;
                        const item = queue.shift();
                        const cacheKey = `DATA_LAPSE_DETAIL_${item.id}_${baseType}`;
                        
                        if (sessionStorage.getItem(cacheKey)) {
                            prefetchNext(); // 이미 캐시가 있으면 즉시 다음 진행
                            return;
                        }
                        
                        try {
                            const res = await callApi('getLapseManagementData', item.id, baseType);
                            if (res && !res.error && res.success) {
                                sessionStorage.setItem(cacheKey, JSON.stringify(res));
                            }
                        } catch (e) {
                            console.error('Prefetch failed for ' + item.id, e);
                        }
                        // GAS 동시성 제한을 피하기 위해 1초 대기 후 다음 요청 수행
                        setTimeout(prefetchNext, 1000);
                    };
                    
                    setTimeout(prefetchNext, 500); // 0.5초 후 예열 프로세스 개시
                }
            }, 10);

            return div;
        }

        function setLapseBaseType(type) {
            if (state.lapseBaseType !== type) {
                state.lapseBaseType = type;
                state.data.lapseAdminSummary = null; // force clear to refresh cache
                render();
            }
        }

        function setRetentionAT(t) { state.retentionAdminTab = t; render(); }

        function createRetentionAdminView() {
            if (state.isLoading) return getSkeletonUI();
            const div = document.createElement('div');
            state.retentionAdminTab = state.retentionAdminTab || 'active';
            state.retentionSortOrder = state.retentionSortOrder || 'lowest13';
            state.retentionOrgFilter = state.retentionOrgFilter || '전체';
            if (state.retentionHideNoRate === undefined) state.retentionHideNoRate = true;

            div.innerHTML = `
                <div class="mb-4">
                    <h2 class="text-xl font-bold text-gray-800 tracking-tight">유지율 조회${(() => { const hd = state.data.homeData || {}; let dm = hd.baseMonth; if (dm && dm.startsWith('20')) dm = dm.replace(/^20(\\d{2}년)/, '$1'); return (dm && dm !== '-') ? ' <span class="text-sm font-normal text-gray-400">(' + dm + ' 기준)</span>' : ''; })()}</h2>
                    <p class="text-gray-500 text-sm mt-1">모집인별 통산 일반 유지율 현황을 조회합니다.</p>
                </div>
                
                <div class="mb-4 border-b border-gray-200">
                    <nav class="-mb-px flex space-x-6">
                        <button onclick="setRetentionAT('active')" class="${state.retentionAdminTab === 'active' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'} whitespace-nowrap py-3 border-b-2 font-medium text-sm transition">위촉자 <span id="retentionActiveCount"></span></button>
                        <button onclick="setRetentionAT('resigned')" class="${state.retentionAdminTab === 'resigned' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'} whitespace-nowrap py-3 border-b-2 font-medium text-sm transition">해촉자 <span id="retentionResignedCount"></span></button>
                    </nav>
                </div>

                <div class="mb-6 flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
                    <div class="relative w-full lg:max-w-xs flex-grow">
                        <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                            <svg class="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd" /></svg>
                        </div>
                        <input type="text" id="retentionAdminSearch" placeholder="모집인 이름 또는 사번 검색" class="w-full pl-11 pr-4 py-2.5 border border-gray-200 rounded-xl bg-white shadow-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition text-sm">
                    </div>
                    
                    <div class="flex flex-wrap items-center gap-2.5">
                        <!-- 소속 필터 드롭박스 -->
                        <div class="relative min-w-[130px] flex-1 sm:flex-none">
                            <select id="retentionAdminOrgFilter" class="w-full appearance-none pl-3 pr-8 py-2.5 border border-gray-200 rounded-xl bg-white shadow-sm text-gray-700 text-sm font-medium focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition cursor-pointer">
                                <option value="전체">전체</option>
                            </select>
                            <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                                <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                            </div>
                        </div>

                        <!-- 정렬 세그먼트 컨트롤 (캡슐 버튼) -->
                        <div class="flex items-center gap-1.5">
                            <label class="text-[11px] font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap flex items-center gap-1">
                                <span class="w-1.5 h-3 bg-primary rounded-sm inline-block"></span>
                                정렬
                            </label>
                            <div id="retentionSortRadioGroup" class="inline-flex flex-wrap p-1 bg-gray-200/60 rounded-xl gap-0.5 border border-gray-200/80">
                                <label class="cursor-pointer select-none">
                                    <input type="radio" name="retentionSortRadio" value="id" ${state.retentionSortOrder === 'id' ? 'checked' : ''} class="sr-only peer">
                                    <span class="px-2.5 py-1 rounded-lg text-xs font-bold transition-all inline-block text-gray-600 hover:text-gray-900 peer-checked:bg-primary peer-checked:text-white peer-checked:shadow-sm">사번</span>
                                </label>
                                <label class="cursor-pointer select-none">
                                    <input type="radio" name="retentionSortRadio" value="lowest13" ${state.retentionSortOrder === 'lowest13' ? 'checked' : ''} class="sr-only peer">
                                    <span class="px-2.5 py-1 rounded-lg text-xs font-bold transition-all inline-block text-gray-600 hover:text-gray-900 peer-checked:bg-primary peer-checked:text-white peer-checked:shadow-sm">13회 최저</span>
                                </label>
                                <label class="cursor-pointer select-none">
                                    <input type="radio" name="retentionSortRadio" value="lowest25" ${state.retentionSortOrder === 'lowest25' ? 'checked' : ''} class="sr-only peer">
                                    <span class="px-2.5 py-1 rounded-lg text-xs font-bold transition-all inline-block text-gray-600 hover:text-gray-900 peer-checked:bg-primary peer-checked:text-white peer-checked:shadow-sm">25회 최저</span>
                                </label>
                                <label class="cursor-pointer select-none">
                                    <input type="radio" name="retentionSortRadio" value="highest13" ${state.retentionSortOrder === 'highest13' ? 'checked' : ''} class="sr-only peer">
                                    <span class="px-2.5 py-1 rounded-lg text-xs font-bold transition-all inline-block text-gray-600 hover:text-gray-900 peer-checked:bg-primary peer-checked:text-white peer-checked:shadow-sm">13회 최고</span>
                                </label>
                                <label class="cursor-pointer select-none">
                                    <input type="radio" name="retentionSortRadio" value="highest25" ${state.retentionSortOrder === 'highest25' ? 'checked' : ''} class="sr-only peer">
                                    <span class="px-2.5 py-1 rounded-lg text-xs font-bold transition-all inline-block text-gray-600 hover:text-gray-900 peer-checked:bg-primary peer-checked:text-white peer-checked:shadow-sm">25회 최고</span>
                                </label>
                            </div>
                        </div>

                        <!-- 유지율 값 없는 사람 제외 체크박스 (정렬 드롭박스 오른쪽) -->
                        <label class="flex items-center gap-2 px-3 py-2.5 bg-white border border-gray-200 rounded-xl shadow-sm cursor-pointer hover:bg-gray-50 transition select-none flex-1 sm:flex-none">
                            <input type="checkbox" id="retentionHideNoRate" ${state.retentionHideNoRate ? 'checked' : ''} class="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary/30 transition cursor-pointer">
                            <span class="text-xs font-semibold text-gray-700 whitespace-nowrap">유지율 없는 카드 제외</span>
                        </label>
                    </div>
                </div>

                <div id="retentionAdminList" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    <div class="col-span-full flex items-center justify-center h-40">
                         <div class="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                    </div>
                </div>
            `;

            const renderCards = (list, filterText = '', sortOrder = state.retentionSortOrder, orgFilter = state.retentionOrgFilter, hideNoRate = state.retentionHideNoRate) => {
                const container = div.querySelector('#retentionAdminList');
                if (!list) return;

                let baseList = list.slice();

                if (orgFilter && orgFilter !== '전체') {
                    baseList = baseList.filter(x => (x.org1 || '').trim() === orgFilter);
                }

                if (hideNoRate) {
                    baseList = baseList.filter(x => {
                        if (x.hasRate !== undefined) return x.hasRate;
                        const has13 = x.retention13 && x.retention13 !== '-' && x.retention13 !== '데이터 없음';
                        const has25 = x.retention25 && x.retention25 !== '-' && x.retention25 !== '데이터 없음';
                        return has13 || has25;
                    });
                }

                const activeList = baseList.filter(x => !x.isResigned);
                const resignedList = baseList.filter(x => x.isResigned);

                const countActive = div.querySelector('#retentionActiveCount');
                if (countActive) countActive.innerText = '(' + activeList.length + ')';
                const countResigned = div.querySelector('#retentionResignedCount');
                if (countResigned) countResigned.innerText = '(' + resignedList.length + ')';

                let currentList = state.retentionAdminTab === 'active' ? activeList.slice() : resignedList.slice();

                if (sortOrder === 'lowest13') {
                    currentList.sort((a, b) => {
                        const valA = (a.retention13Raw !== null && a.retention13Raw !== undefined) ? a.retention13Raw : 999999;
                        const valB = (b.retention13Raw !== null && b.retention13Raw !== undefined) ? b.retention13Raw : 999999;
                        if (valA !== valB) return valA - valB;
                        return String(a.id).localeCompare(String(b.id));
                    });
                } else if (sortOrder === 'highest13') {
                    currentList.sort((a, b) => {
                        const valA = (a.retention13Raw !== null && a.retention13Raw !== undefined) ? a.retention13Raw : -1;
                        const valB = (b.retention13Raw !== null && b.retention13Raw !== undefined) ? b.retention13Raw : -1;
                        if (valA !== valB) return valB - valA;
                        return String(a.id).localeCompare(String(b.id));
                    });
                } else if (sortOrder === 'lowest25') {
                    currentList.sort((a, b) => {
                        const valA = (a.retention25Raw !== null && a.retention25Raw !== undefined) ? a.retention25Raw : 999999;
                        const valB = (b.retention25Raw !== null && b.retention25Raw !== undefined) ? b.retention25Raw : 999999;
                        if (valA !== valB) return valA - valB;
                        return String(a.id).localeCompare(String(b.id));
                    });
                } else if (sortOrder === 'highest25') {
                    currentList.sort((a, b) => {
                        const valA = (a.retention25Raw !== null && a.retention25Raw !== undefined) ? a.retention25Raw : -1;
                        const valB = (b.retention25Raw !== null && b.retention25Raw !== undefined) ? b.retention25Raw : -1;
                        if (valA !== valB) return valB - valA;
                        return String(a.id).localeCompare(String(b.id));
                    });
                } else { // 'id' (사번순)
                    currentList.sort((a, b) => String(a.id).localeCompare(String(b.id)));
                }

                const fText = (filterText || '').toLowerCase();
                const filtered = currentList.filter(x => x.name.toLowerCase().includes(fText) || String(x.id).includes(fText));

                if (filtered.length === 0) {
                    container.innerHTML = `<div class="col-span-full bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center text-gray-500">조회된 유지율 내역이 없습니다.</div>`;
                    return;
                }

                container.innerHTML = filtered.map(item => `
                    <div class="bg-white rounded-2xl shadow-sm hover:shadow-lg transition-all duration-300 p-5 border border-gray-100 flex flex-col group cursor-pointer relative" onclick="fetchAndShowLapsedContractsByRecruiter('${item.id}', '${item.name}')">
                         <div class="absolute top-4 right-4 bg-red-50 text-red-600 px-2.5 py-1 rounded-full text-[11px] font-bold border border-red-100 flex items-center gap-1 shadow-sm opacity-90 group-hover:opacity-100 transition-opacity">
                             <span>실효</span>
                             <span>${item.lapsedCount || 0}</span>
                         </div>
                         <div class="flex justify-between items-center mb-3 border-b border-gray-50 pb-3 pr-16 mt-1">
                             <div>
                                 <h3 class="font-bold text-lg text-gray-900 flex items-center gap-2">
                                     <div class="w-1.5 h-1.5 rounded-full bg-indigo-500/70"></div>
                                     ${item.name} <span class="text-xs text-gray-400 font-normal">(${item.id})</span>
                                     ${item.org1 ? `<span class="text-[11px] font-normal text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">${item.org1}</span>` : ''}
                                 </h3>
                             </div>
                         </div>
                         <div class="grid grid-cols-2 gap-3 text-center">
                            <div class="bg-gray-50/50 p-3 rounded-xl border border-gray-100/80">
                                <p class="text-[11px] text-gray-500 font-bold uppercase mb-1">13회차</p>
                                <p class="text-xl font-extrabold ${item.retention13Raw !== null && item.retention13Raw < 90 ? 'text-red-500' : 'text-gray-800'}">${item.retention13}</p>
                            </div>
                            <div class="bg-gray-50/50 p-3 rounded-xl border border-gray-100/80">
                                <p class="text-[11px] text-gray-500 font-bold uppercase mb-1">25회차</p>
                                <p class="text-xl font-extrabold ${item.retention25Raw !== null && item.retention25Raw < 80 ? 'text-red-500' : 'text-gray-800'}">${item.retention25}</p>
                            </div>
                         </div>
                    </div>
                `).join('');
            };

            const populateOrgFilter = (list) => {
                const orgSelect = div.querySelector('#retentionAdminOrgFilter');
                if (!orgSelect || !list) return;
                const orgSet = new Set();
                list.forEach(item => {
                    const o = (item.org1 || '').trim();
                    if (o && o !== '-' && o !== 'undefined') orgSet.add(o);
                });
                const sortedOrgs = Array.from(orgSet).sort((a, b) => a.localeCompare(b, 'ko'));
                
                orgSelect.innerHTML = `<option value="전체">전체</option>` + sortedOrgs.map(o => `<option value="${o}" ${state.retentionOrgFilter === o ? 'selected' : ''}>${o}</option>`).join('');
            };

            setTimeout(async () => {
                if (!state.data.retentionAdminSummary) {
                    const res = await callApi('getAdminRetentionSummary', state.user.staffId);
                    if (res.error || !res.success) {
                        div.querySelector('#retentionAdminList').innerHTML = `<div class="col-span-full p-8 text-center text-red-500 bg-red-50 rounded-2xl border border-red-100">데이터를 불러오지 못했습니다.<br><span class="text-sm">${res.message || '네트워크 오류'}</span></div>`;
                        return;
                    }
                    state.data.retentionAdminSummary = res.list || [];
                }

                populateOrgFilter(state.data.retentionAdminSummary);

                const searchInput = div.querySelector('#retentionAdminSearch');
                const sortRadios = div.querySelectorAll('input[name="retentionSortRadio"]');
                const orgSelect = div.querySelector('#retentionAdminOrgFilter');
                const hideNoRateCheck = div.querySelector('#retentionHideNoRate');

                const updateView = () => {
                    renderCards(state.data.retentionAdminSummary, searchInput.value.trim(), state.retentionSortOrder, state.retentionOrgFilter, state.retentionHideNoRate);
                };

                searchInput.addEventListener('input', updateView);
                sortRadios.forEach(r => {
                    r.addEventListener('change', (e) => {
                        if (e.target.checked) {
                            state.retentionSortOrder = e.target.value;
                            updateView();
                        }
                    });
                });
                orgSelect.addEventListener('change', (e) => {
                    state.retentionOrgFilter = e.target.value;
                    updateView();
                });
                if (hideNoRateCheck) {
                    hideNoRateCheck.addEventListener('change', (e) => {
                        state.retentionHideNoRate = e.target.checked;
                        updateView();
                    });
                }

                updateView();
            }, 10);

            return div;
        }

        window.fetchAndShowLapsedContractsByRecruiter = async function (staffId, staffName) {
            const cacheKey = `DATA_LAPSED_REC_${state.user.staffId}_${staffId}`;
            let cached = sessionStorage.getItem(cacheKey);
            let res = null;
            if (cached) { try { res = JSON.parse(cached); } catch (e) { } }

            if (!res) {
                showLoading(true);
                res = await callApi('getLapsedContractsByRecruiter', state.user.staffId, staffId);
                showLoading(false);
                if (res && !res.error && res.success) {
                    sessionStorage.setItem(cacheKey, JSON.stringify(res));
                }
            }

            if (res && (res.error || !res.success)) {
                alert('상세 내역을 불러오지 못했습니다: ' + (res.message || '알 수 없는 오류'));
                return;
            }

            // Using the existing modal template, but providing staff name as title context
            const titleContext = `[${staffName}] `;
            showLapsedContractsModal(res.list || [], titleContext);
        };

        window.fetchAndShowLapseAdminDetail = async function (staffId, staffName, type) {
            const cacheKey = `DATA_LAPSE_DETAIL_${staffId}_${state.lapseBaseType}`;
            let cached = sessionStorage.getItem(cacheKey);
            let res = null;
            if (cached) { try { res = JSON.parse(cached); } catch (e) { } }

            if (!res) {
                showLoading(true);
                res = await callApi('getLapseManagementData', staffId, state.lapseBaseType);
                showLoading(false);
                if (res && !res.error && res.success) {
                    sessionStorage.setItem(cacheKey, JSON.stringify(res));
                }
            }

            if (res && (res.error || !res.success)) {
                alert('상세 내역을 불러오지 못했습니다: ' + (res.message || '알 수 없는 오류'));
                return;
            }

            let dataToRender = [];
            if (type === 'lapsed') dataToRender = (res.lapsed || []);
            else if (type === 'arrears') dataToRender = (res.arrears || []);
            else if (type === 'unpaid') dataToRender = (res.unpaid || []);
            else if (type === 'unsubmitted') dataToRender = (res.unsubmitted || []);

            openLapseAdminDetailModal(dataToRender, staffName, type);
        };

        function formatLapseDate(val) {
            if (!val || val === '-' || val === 'undefined') return '-';
            if (typeof val === 'string') {
                if (val.includes('T') || val.includes('Z')) {
                    const d = new Date(val);
                    if (!isNaN(d.getTime())) {
                        const y = d.getFullYear();
                        const m = String(d.getMonth() + 1).padStart(2, '0');
                        const day = String(d.getDate()).padStart(2, '0');
                        return `${y}-${m}-${day}`;
                    }
                }
                if (val.length >= 10 && /^\d{4}[-./]\d{2}[-./]\d{2}/.test(val)) {
                    return val.substring(0, 10).replace(/[./]/g, '-');
                }
                return val;
            }
            if (val instanceof Date) {
                const y = val.getFullYear();
                const m = String(val.getMonth() + 1).padStart(2, '0');
                const day = String(val.getDate()).padStart(2, '0');
                return `${y}-${m}-${day}`;
            }
            return String(val);
        }

        window.openLapseAdminDetailModal = function (data, staffName, type) {
            document.body.classList.add('modal-open');
            const modal = document.createElement('div');
            modal.className = "fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 fade-in";

            const isArrears = type === 'arrears';
            const isUnpaid = type === 'unpaid';
            const isUnsubmitted = type === 'unsubmitted';
            const colorClass = isUnsubmitted ? 'indigo' : (isUnpaid ? 'blue' : (isArrears ? 'orange' : 'red'));
            const titleText = isUnsubmitted ? '신계약 확인서 미제출 리스트' : (isUnpaid ? '당월 미납계약 리스트' : (isArrears ? '당월 연체계약 리스트' : '당월 실효계약 리스트'));

            const theadHtml = isUnsubmitted ? `
                <thead class="bg-gray-100/80 sticky top-0 z-10 shadow-sm backdrop-blur-sm"><tr class="text-left text-gray-600 border-b border-gray-200">
                    <th class="p-3 font-semibold text-center">제출여부</th>
                    <th class="p-3 font-semibold text-center">모집인</th>
                    <th class="p-3 font-semibold">보험사</th>
                    <th class="p-3 font-semibold">증권번호</th>
                    <th class="p-3 font-semibold">상품명</th>
                    <th class="p-3 text-right font-semibold">보험료</th>
                    <th class="p-3 font-semibold">계약일</th>
                    <th class="p-3 text-center font-semibold">계약자</th>
                    <th class="p-3 text-center font-semibold">기준일</th>
                </tr></thead>
            ` : `
                <thead class="bg-gray-100/80 sticky top-0 z-10 shadow-sm backdrop-blur-sm"><tr class="text-left text-gray-600 border-b border-gray-200">
                    <th class="p-3 font-semibold text-center">상태</th>
                    <th class="p-3 font-semibold text-center">모집인</th>
                    <th class="p-3 font-semibold text-center text-gray-800">수금인</th>
                    <th class="p-3 font-semibold">보험사</th>
                    <th class="p-3 font-semibold">증권번호</th>
                    <th class="p-3 font-semibold">상품명</th>
                    <th class="p-3 text-right font-semibold">계속보험료</th>
                    <th class="p-3 font-semibold min-w-[85px]">계약일</th>
                    <th class="p-3 text-center font-semibold">납입회차</th>
                    <th class="p-3 text-center font-semibold">최종납입월</th>
                    <th class="p-3 text-center font-semibold">계약자</th>
                    <th class="p-3 text-center font-semibold min-w-[85px]">기준일</th>
                </tr></thead>
            `;

            const rows = data.length ? data.map(x => {
                if (isUnsubmitted) {
                    return `
                     <tr class="border-b border-gray-100 hover:bg-gray-50 transition">
                       <td class="p-3 text-center">
                           <span class="px-2 py-1 text-[10px] font-bold rounded-lg bg-red-50 text-red-600 border border-red-100">미제출</span>
                       </td>
                       <td class="p-3 text-center text-gray-700">${x['모집인']}</td>
                       <td class="p-3 text-gray-700">${x['보험사']}</td>
                       <td class="p-3 text-xs text-gray-500 font-mono">${maskPolicyNo(x['증권번호'])}</td>
                       <td class="p-3 font-medium text-gray-800"><div class="truncate-product" title="${x['상품명']}">${x['상품명']}</div></td>
                       <td class="p-3 text-right font-medium text-blue-600 tabular-nums">${formatMoney(x['보험료'])}</td>
                       <td class="p-3 text-xs text-gray-500">${formatLapseDate(x['계약일'])}</td>
                       <td class="p-3 text-center font-medium text-gray-700">${maskContractor(x['계약자'])}</td>
                       <td class="p-3 text-xs text-gray-500 text-center min-w-[85px] font-mono">${formatLapseDate(x['데이터기준일'])}</td>
                     </tr>`;
                } else {
                    return `
                     <tr class="border-b border-gray-100 hover:bg-gray-50 transition">
                       <td class="p-3 text-center">
                           <span class="px-2 py-1 text-[10px] font-bold rounded-lg ${String(x['계약상태']).includes('실효') ? 'bg-red-50 text-red-600 border border-red-100' : (String(x['계약상태']).includes('연체') ? 'bg-orange-50 text-orange-600 border border-orange-100' : 'bg-gray-100 text-gray-600')}">${x['계약상태']}</span>
                       </td>
                       <td class="p-3 text-center text-gray-700">${x['모집인명']}</td>
                       <td class="p-3 text-center font-bold text-gray-800">${x['수금인명']}</td>
                       <td class="p-3 text-gray-700 max-w-[80px] truncate">${x['보험사']}</td>
                       <td class="p-3 text-xs text-gray-500 font-mono">${maskPolicyNo(x['증권번호'])}</td>
                       <td class="p-3 font-medium text-gray-800"><div class="truncate-product" title="${x['상품명']}">${x['상품명']}</div></td>
                       <td class="p-3 text-right font-medium text-blue-600 tabular-nums">${formatMoney(x['계속보험료'])}</td>
                       <td class="p-3 text-xs text-gray-500 min-w-[85px]">${formatLapseDate(x['계약일'])}</td>
                       <td class="p-3 text-center text-xs text-gray-600">${x['납입회차']}</td>
                       <td class="p-3 text-center text-xs bg-gray-50 text-gray-500 font-mono">${x['최종납입월']}</td>
                       <td class="p-3 text-center font-medium text-gray-700">${x['계약자']}</td>
                       <td class="p-3 text-xs text-gray-500 text-center min-w-[85px] font-mono">${formatLapseDate(x['데이터기준일'])}</td>
                     </tr>`;
                }
            }).join('') : `<tr><td colspan="${isUnsubmitted ? 9 : 12}" class="p-12 text-center text-gray-500">해당하는 계약 내역이 없습니다.</td></tr>`;

            modal.innerHTML = `<div class="bg-white rounded-2xl shadow-2xl w-full max-w-[95%] xl:max-w-[1280px] flex flex-col max-h-[90vh] overflow-hidden transform transition-all scale-100 ring-1 ring-black/5">
                <div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                    <h3 class="font-bold text-xl text-gray-800 flex items-center gap-3">
                        <span class="w-1.5 h-6 bg-${colorClass}-400 rounded-full block shadow-sm"></span>
                        <span>[${staffName}] ${titleText} <span class="text-sm font-normal text-gray-500 ml-2">(총 <span class="text-${colorClass}-500 font-bold">${data.length}</span>건)</span></span>
                    </h3>
                    <button class="close p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition focus:outline-none"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
                </div>
                <div class="overflow-x-auto flex-grow bg-white p-0">
                    <table class="w-full text-sm whitespace-nowrap min-w-[1000px]">
                        ${theadHtml}
                        <tbody class="divide-y divide-gray-100">${rows}</tbody>
                    </table>
                </div>
                <div class="p-4 bg-gray-50 border-t border-gray-100 text-right">
                    <button class="close px-6 py-2.5 bg-gray-800 hover:bg-gray-900 text-white font-medium rounded-xl shadow-lg shadow-gray-200 transition">닫기</button>
                </div>
            </div>`;
            document.body.appendChild(modal);
            modal.querySelectorAll('.close').forEach(b => b.onclick = () => {
                document.body.classList.remove('modal-open');
                modal.remove();
            });
        };

        window.printAllLapseAdminDetails = async function () {
            const includeUnpaid = document.getElementById('includeUnpaidPrint')?.checked || false;
            let list = state.data.lapseAdminSummary;
            if (!list || list.length === 0) {
                alert('출력할 대상이 없습니다.');
                return;
            }

            const activeTab = state.lapseAdminTab || 'active';
            const searchInput = document.getElementById('lapseAdminSearch');
            const fText = (searchInput ? searchInput.value : '').toLowerCase();

            list = activeTab === 'active' ? list.filter(x => !x.isResigned) : list.filter(x => x.isResigned);
            if (fText) {
                list = list.filter(x => x.name.toLowerCase().includes(fText) || String(x.id).includes(fText));
            }

            const targetList = list.filter(x => (x.lapsed && parseInt(x.lapsed) > 0) || (x.arrears && parseInt(x.arrears) > 0) || (includeUnpaid && x.unpaid && parseInt(x.unpaid) > 0) || (x.unsubmitted && parseInt(x.unsubmitted) > 0));

            if (targetList.length === 0) {
                alert('현재 조회된 인원 중 ' + (includeUnpaid ? '당월 실효, 연체, 미납 또는 확인서 미제출' : '당월 실효, 연체 또는 확인서 미제출') + ' 건이 있는 대상이 없습니다.');
                return;
            }

            showLoading(true);

            const today = new Date();
            const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

            let printHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <title>실효연체 리스트 일괄 프린트</title>
                <style>
                    @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css');
                    body { font-family: 'Pretendard', sans-serif; margin: 0; padding: 0; color: #111; background: #fff; }
                    .page { page-break-after: always; padding: 25px; box-sizing: border-box; width: 100%; height: 100vh; overflow: hidden; }
                    .page:last-child { page-break-after: auto; }
                    .header { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #222; padding-bottom: 12px; margin-bottom: 20px; }
                    .header-pill { background: #eff6ff; color: #3b82f6; padding: 4px 10px; border-radius: 6px; font-weight: 700; font-size: 14px; margin-right: 12px; border: 1px solid #bfdbfe; }
                    h2 { font-size: 20px; font-weight: 800; margin: 0; letter-spacing: -0.5px; }
                    .section-title { font-size: 15px; font-weight: 700; color: #333; margin-top: 24px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
                    .section-title.lapsed::before { content: ''; display: block; width: 6px; height: 16px; background-color: #ef4444; border-radius: 4px; }
                    .section-title.arrears::before { content: ''; display: block; width: 6px; height: 16px; background-color: #f97316; border-radius: 4px; }
                    .section-title.unpaid::before { content: ''; display: block; width: 6px; height: 16px; background-color: #2563eb; border-radius: 4px; }
                    .section-title.unsubmitted::before { content: ''; display: block; width: 6px; height: 16px; background-color: #6366f1; border-radius: 4px; }
                    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11px; }
                    th, td { border: 1px solid #d1d5db; padding: 7px 8px; text-align: center; word-break: keep-all; }
                    th { background-color: #f3f4f6; font-weight: 700; color: #4b5563; }
                    td { color: #374151; }
                    .text-left { text-align: left; }
                    .text-right { text-align: right; }
                    .font-bold { font-weight: 700; }
                    .empty-message { padding: 20px; text-align: center; color: #6b7280; font-style: italic; border: 1px dashed #e5e7eb; background: #f9fafb; border-radius: 8px; font-size: 13px; }
                    .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; }
                    .badge-red { background: #fef2f2; color: #dc2626; border: 1px solid #fee2e2; }
                    .badge-orange { background: #fff7ed; color: #ea580c; border: 1px solid #ffedd5; }
                    .badge-blue { background: #eff6ff; color: #2563eb; border: 1px solid #dbeafe; }
                    .badge-gray { background: #f3f4f6; color: #4b5563; border: 1px solid #e5e7eb; }
                    .footer-note { text-align: right; font-size: 10px; color: #9ca3af; margin-top: 20px; }
                    .tabular-nums { font-variant-numeric: tabular-nums; }
                    .truncate-product { max-width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
                    @media print {
                        @page { size: A4 landscape; margin: 10mm; }
                        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                        .page { height: auto; }
                    }
                </style>
            </head>
            <body>
            `;

            for (const person of targetList) {
                const cacheKey = `DATA_LAPSE_DETAIL_${person.id}_${state.lapseBaseType}`;
                let d = null;
                const cached = sessionStorage.getItem(cacheKey);
                if (cached) { try { d = JSON.parse(cached); } catch (e) { } }

                if (!d) {
                    d = await callApi('getLapseManagementData', person.id, state.lapseBaseType);
                    if (d && !d.error && d.success) {
                        sessionStorage.setItem(cacheKey, JSON.stringify(d));
                    }
                }

                if (!d || d.error || !d.success) {
                    console.error(`Failed to fetch data for ${person.name}(${person.id})`);
                    continue;
                }

                const lapsedData = d.lapsed || [];
                const arrearsData = d.arrears || [];
                const unpaidData = d.unpaid || [];
                const unsubmittedData = d.unsubmitted || [];

                printHtml += `<div class="page">
                    <div class="header">
                        <div style="display: flex; align-items: center;">
                            <span class="header-pill">${state.lapseBaseType === 'recruiter' ? '모집인 기준' : '수금인 기준'}</span>
                            <h2>[${person.name}] 당월 계약유지 및 확인서 미제출 상세 리스트</h2>
                        </div>
                        <div style="font-size: 13px; font-weight: 600; color: #555;">출력일 : ${todayStr}</div>
                    </div>`;

                // 실효 계약
                printHtml += `<div class="section-title lapsed">당월 실효계약 리스트 (총 ${lapsedData.length}건)</div>`;
                if (lapsedData.length > 0) {
                    printHtml += `<table>
                        <thead>
                            <tr>
                                <th style="width: 5%">상태</th>
                                <th style="width: 6%">모집인</th>
                                <th style="width: 6%">수금인</th>
                                <th style="width: 8%">보험사</th>
                                <th style="width: 12%">증권번호</th>
                                <th style="width: 20%" class="text-left">상품명</th>
                                <th style="width: 9%" class="text-right">계속보험료</th>
                                <th style="width: 85px; min-width: 85px; white-space: nowrap;">계약일</th>
                                <th style="width: 5%">회차</th>
                                <th style="width: 6%">최종납입</th>
                                <th style="width: 7%">계약자</th>
                                <th style="width: 85px; min-width: 85px; white-space: nowrap;">기준일</th>
                            </tr>
                        </thead>
                        <tbody>`;
                    lapsedData.forEach(x => {
                        let statusClass = 'badge-gray';
                        if (String(x['계약상태']).includes('실효')) statusClass = 'badge-red';
                        else if (String(x['계약상태']).includes('연체')) statusClass = 'badge-orange';

                        printHtml += `<tr>
                            <td><span class="badge ${statusClass}">${x['계약상태']}</span></td>
                            <td>${x['모집인명']}</td>
                            <td class="font-bold">${x['수금인명']}</td>
                            <td>${x['보험사']}</td>
                            <td style="font-family: monospace;">${x['증권번호']}</td>
                            <td class="text-left font-bold" style="color:#1f2937;"><div class="truncate-product" title="${x['상품명']}">${x['상품명']}</div></td>
                            <td class="text-right font-bold tabular-nums" style="color:#2563eb;">${formatMoney(x['계속보험료'])}</td>
                            <td style="min-width: 85px;">${x['계약일']}</td>
                            <td>${x['납입회차']}</td>
                            <td style="font-family: monospace;">${x['최종납입월']}</td>
                            <td class="font-bold" style="color:#2563eb;">${x['계약자']}</td>
                            <td style="color:#6b7280; font-size:10px; min-width: 85px;">${x['데이터기준일'] || '-'}</td>
                        </tr>`;
                    });
                    printHtml += `</tbody></table>`;
                } else {
                    printHtml += `<div class="empty-message">해당하는 실효 계약 내역이 없습니다.</div>`;
                }

                // 연체 계약
                printHtml += `<div class="section-title arrears">당월 연체계약 리스트 (총 ${arrearsData.length}건)</div>`;
                if (arrearsData.length > 0) {
                    printHtml += `<table>
                        <thead>
                            <tr>
                                <th style="width: 5%">상태</th>
                                <th style="width: 6%">모집인</th>
                                <th style="width: 6%">수금인</th>
                                <th style="width: 8%">보험사</th>
                                <th style="width: 12%">증권번호</th>
                                <th style="width: 20%" class="text-left">상품명</th>
                                <th style="width: 9%" class="text-right">계속보험료</th>
                                <th style="width: 85px; min-width: 85px; white-space: nowrap;">계약일</th>
                                <th style="width: 5%">회차</th>
                                <th style="width: 6%">최종납입</th>
                                <th style="width: 7%">계약자</th>
                                <th style="width: 85px; min-width: 85px; white-space: nowrap;">기준일</th>
                            </tr>
                        </thead>
                        <tbody>`;
                    arrearsData.forEach(x => {
                        let statusClass = 'badge-gray';
                        if (String(x['계약상태']).includes('실효')) statusClass = 'badge-red';
                        else if (String(x['계약상태']).includes('연체')) statusClass = 'badge-orange';

                        printHtml += `<tr>
                            <td><span class="badge ${statusClass}">${x['계약상태']}</span></td>
                            <td>${x['모집인명']}</td>
                            <td class="font-bold">${x['수금인명']}</td>
                            <td>${x['보험사']}</td>
                            <td style="font-family: monospace;">${x['증권번호']}</td>
                            <td class="text-left font-bold" style="color:#1f2937;"><div class="truncate-product" title="${x['상품명']}">${x['상품명']}</div></td>
                            <td class="text-right font-bold tabular-nums" style="color:#2563eb;">${formatMoney(x['계속보험료'])}</td>
                            <td style="min-width: 85px;">${x['계약일']}</td>
                            <td>${x['납입회차']}</td>
                            <td style="font-family: monospace;">${x['최종납입월']}</td>
                            <td class="font-bold" style="color:#2563eb;">${x['계약자']}</td>
                            <td style="color:#6b7280; font-size:10px; min-width: 85px;">${x['데이터기준일'] || '-'}</td>
                        </tr>`;
                    });
                    printHtml += `</tbody></table>`;
                } else {
                    printHtml += `<div class="empty-message">해당하는 연체 계약 내역이 없습니다.</div>`;
                }

                // 미납 계약 (체크박스 활성화 시에만 포함)
                if (includeUnpaid) {
                    printHtml += `<div class="section-title unpaid">당월 미납계약 리스트 (총 ${unpaidData.length}건)</div>`;
                    if (unpaidData.length > 0) {
                        printHtml += `<table>
                            <thead>
                                <tr>
                                    <th style="width: 5%">상태</th>
                                    <th style="width: 6%">모집인</th>
                                    <th style="width: 6%">수금인</th>
                                    <th style="width: 8%">보험사</th>
                                    <th style="width: 12%">증권번호</th>
                                    <th style="width: 20%" class="text-left">상품명</th>
                                    <th style="width: 9%" class="text-right">계속보험료</th>
                                    <th style="width: 85px; min-width: 85px; white-space: nowrap;">계약일</th>
                                    <th style="width: 5%">회차</th>
                                    <th style="width: 6%">최종납입</th>
                                    <th style="width: 7%">계약자</th>
                                    <th style="width: 85px; min-width: 85px; white-space: nowrap;">기준일</th>
                                </tr>
                            </thead>
                            <tbody>`;
                        unpaidData.forEach(x => {
                            let statusClass = 'badge-blue';
                            printHtml += `<tr>
                                <td><span class="badge ${statusClass}">${x['계약상태']}</span></td>
                                <td>${x['모집인명']}</td>
                                <td class="font-bold">${x['수금인명']}</td>
                                <td>${x['보험사']}</td>
                                <td style="font-family: monospace;">${x['증권번호']}</td>
                                <td class="text-left font-bold" style="color:#1f2937;"><div class="truncate-product" title="${x['상품명']}">${x['상품명']}</div></td>
                                <td class="text-right font-bold tabular-nums" style="color:#2563eb;">${formatMoney(x['계속보험료'])}</td>
                                <td style="min-width: 85px;">${x['계약일']}</td>
                                <td>${x['납입회차']}</td>
                                <td style="font-family: monospace;">${x['최종납입월']}</td>
                                <td class="font-bold" style="color:#2563eb;">${x['계약자']}</td>
                                <td style="color:#6b7280; font-size:10px; min-width: 85px;">${x['데이터기준일'] || '-'}</td>
                            </tr>`;
                        });
                        printHtml += `</tbody></table>`;
                    } else {
                        printHtml += `<div class="empty-message">해당하는 미납 계약 내역이 없습니다.</div>`;
                    }
                }

                // 확인서 미제출 계약
                printHtml += `<div class="section-title unsubmitted">신계약 확인서 미제출 리스트 (총 ${unsubmittedData.length}건)</div>`;
                if (unsubmittedData.length > 0) {
                    printHtml += `<table>
                        <thead>
                            <tr>
                                <th style="width: 8%">제출여부</th>
                                <th style="width: 10%">모집인</th>
                                <th style="width: 12%">보험사</th>
                                <th style="width: 15%">증권번호</th>
                                <th style="width: 25%" class="text-left">상품명</th>
                                <th style="width: 10%" class="text-right">보험료</th>
                                <th style="width: 85px; min-width: 85px; white-space: nowrap;">계약일</th>
                                <th style="width: 10%">계약자</th>
                                <th style="width: 85px; min-width: 85px; white-space: nowrap;">기준일</th>
                            </tr>
                        </thead>
                        <tbody>`;
                    unsubmittedData.forEach(x => {
                        printHtml += `<tr>
                            <td><span class="badge badge-red">미제출</span></td>
                            <td>${x['모집인']}</td>
                            <td>${x['보험사']}</td>
                            <td style="font-family: monospace;">${x['증권번호']}</td>
                            <td class="text-left font-bold" style="color:#1f2937;"><div class="truncate-product" title="${x['상품명']}">${x['상품명']}</div></td>
                            <td class="text-right font-bold tabular-nums" style="color:#2563eb;">${formatMoney(x['보험료'])}</td>
                            <td style="min-width: 85px;">${x['계약일']}</td>
                            <td class="font-bold" style="color:#2563eb;">${maskContractor(x['계약자'])}</td>
                            <td style="color:#6b7280; font-size:10px; min-width: 85px;">${x['데이터기준일'] || '-'}</td>
                        </tr>`;
                    });
                    printHtml += `</tbody></table>`;
                } else {
                    printHtml += `<div class="empty-message">해당하는 확인서 미제출 계약 내역이 없습니다.</div>`;
                }

                printHtml += `<div class="footer-note">* 본 자료는 작성 시점 기준이며 실시간 데이터 반영 등에 따라 실제와 다를 수 있습니다.</div></div>`;
            }

            printHtml += `
            <script>
                window.onload = function() {
                    setTimeout(function() {
                        window.print();
                    }, 800);
                }
    <\/script>
</body>

</html>
                    `;

            showLoading(false);

            const printWin = window.open('', '_blank');
            if (printWin) {
                printWin.document.open();
                printWin.document.write(printHtml);
                printWin.document.close();
            } else {
                alert('팝업 차단이 활성화되어 있습니다. 브라우저 설정에서 팝업 차단을 해제한 후 다시 시도해주세요.');
            }
        };

        // ExcelJS 라이브러리 동적 로드 헬퍼
        function loadExcelJS(callback) {
            if (window.ExcelJS) {
                callback();
                return;
            }
            const script = document.createElement('script');
            script.src = "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.3.0/exceljs.min.js";
            script.onload = callback;
            script.onerror = () => {
                showLoading(false);
                alert('엑셀 라이브러리(ExcelJS) 로드에 실패했습니다. 네트워크 연결 상태를 확인해주세요.');
            };
            document.head.appendChild(script);
        }

        window.downloadAllLapseAdminExcel = async function () {
            showLoading(true);
            loadExcelJS(async () => {
                try {
                    const res = await callApi('getAdminLapseArrearsDetailsAll', state.user.staffId, state.lapseBaseType);
                    showLoading(false);
                    
                    if (res.error || !res.success) {
                        alert('엑셀 데이터를 가져오지 못했습니다: ' + (res.message || '네트워크 오류'));
                        return;
                    }
                    
                    const list = res.list || [];
                    if (list.length === 0) {
                        alert('저장할 실효/연체 계약 내역이 없습니다.');
                        return;
                    }
                    
                    const workbook = new ExcelJS.Workbook();
                    const worksheet = workbook.addWorksheet('실효연체리스트');
                    
                    // 첫 행 고정 (Freeze Pane)
                    worksheet.views = [
                        { state: 'frozen', xSplit: 0, ySplit: 1 }
                    ];
                    
                    // 헤더 추가
                    const header = ['상태', '모집인', '수금인', '보험사', '증권번호', '상품명', '계속보험료', '계약일', '납입회차', '최종납입월', '계약자', '기준일'];
                    const headerRow = worksheet.addRow(header);
                    
                    // 헤더 스타일 지정
                    headerRow.eachCell((cell) => {
                        cell.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FF4F46E5' }
                        };
                        cell.font = {
                            name: '맑은 고딕',
                            size: 10,
                            color: { argb: 'FFFFFFFF' },
                            bold: true
                        };
                        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
                        cell.border = {
                            top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
                            left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
                            bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
                            right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
                        };
                    });
                    
                    // 위촉자와 해촉자 분리
                    const activeList = list.filter(x => !x.isResigned);
                    const resignedList = list.filter(x => !!x.isResigned);

                    // 리스트 렌더링 헬퍼 함수
                    const renderListToSheet = (dataList) => {
                        let prevId = null;
                        dataList.forEach(x => {
                            const currentId = x['사번'];
                            const currentName = state.lapseBaseType === 'collector' ? x['수금인명'] : x['모집인명'];
                            
                            // 파트너(사번) 변경 시 구분선 주입
                            if (prevId !== currentId) {
                                const mergeRow = worksheet.addRow([`${currentName} (${currentId})`]);
                                worksheet.mergeCells(mergeRow.number, 1, mergeRow.number, 12);
                                
                                // 구분선 스타일 지정
                                mergeRow.getCell(1).fill = {
                                    type: 'pattern',
                                    pattern: 'solid',
                                    fgColor: { argb: 'FFF3F4F6' }
                                };
                                mergeRow.getCell(1).font = {
                                    name: '맑은 고딕',
                                    size: 10,
                                    color: { argb: 'FF374151' },
                                    bold: true
                                };
                                mergeRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', wrapText: false };
                                
                                for (let i = 1; i <= 12; i++) {
                                    const cell = mergeRow.getCell(i);
                                    cell.border = {
                                        top: { style: 'medium', color: { argb: 'FF9CA3AF' } },
                                        bottom: { style: 'medium', color: { argb: 'FF9CA3AF' } },
                                        left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
                                        right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
                                    };
                                }
                            }
                            
                            const rawPolicyNo = x['증권번호'] || '-';
                            const policyNoVal = (!isNaN(Number(rawPolicyNo)) && String(rawPolicyNo).trim() !== '' && !String(rawPolicyNo).includes('-') && !String(rawPolicyNo).includes(' ')) ? Number(rawPolicyNo) : rawPolicyNo;

                            const dataRow = worksheet.addRow([
                                x['계약상태'] || '-',
                                x['모집인명'] || '-',
                                x['수금인명'] || '-',
                                x['보험사'] || '-',
                                policyNoVal,
                                x['상품명'] || '-',
                                Number(x['계속보험료'] || 0),
                                formatLapseDate(x['계약일']),
                                x['납입회차'] || '-',
                                x['최종납입월'] || '-',
                                x['계약자'] || '-',
                                formatLapseDate(x['데이터기준일'])
                            ]);
                            
                            dataRow.eachCell((cell, colNumber) => {
                                cell.font = { name: '맑은 고딕', size: 10 };
                                cell.border = {
                                    top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
                                    left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
                                    bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
                                    right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
                                };
                                
                                if (colNumber === 1) {
                                    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
                                    if (cell.value === '실효') {
                                        cell.font.color = { argb: 'FFEF4444' };
                                        cell.font.bold = true;
                                    } else if (cell.value === '연체') {
                                        cell.font.color = { argb: 'FF2563EB' };
                                        cell.font.bold = true;
                                    }
                                }
                                else if ([2, 3, 8, 9, 10, 11, 12].includes(colNumber)) {
                                    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
                                }
                                else if (colNumber === 5) {
                                    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
                                    cell.numFmt = '0';
                                }
                                else if (colNumber === 7) {
                                    cell.alignment = { vertical: 'middle', horizontal: 'right', wrapText: false };
                                    cell.numFmt = '#,##0';
                                }
                                else if (colNumber === 6) {
                                    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false };
                                }
                                else if (colNumber === 4) {
                                    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false };
                                }
                            });
                            
                            prevId = currentId;
                        });
                    };

                    // 1. 위촉자 리스트업
                    if (activeList.length > 0) {
                        renderListToSheet(activeList);
                    }

                    // 2. 해촉자 리스트업 (해촉자가 존재할 경우 해촉자 타이틀 행 추가 후 리스트업)
                    if (resignedList.length > 0) {
                        const resignedTitleRow = worksheet.addRow(['■ 해촉자']);
                        worksheet.mergeCells(resignedTitleRow.number, 1, resignedTitleRow.number, 12);
                        
                        // 해촉자 타이틀 스타일 지정
                        resignedTitleRow.getCell(1).fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FFE2E8F0' }
                        };
                        resignedTitleRow.getCell(1).font = {
                            name: '맑은 고딕',
                            size: 11,
                            color: { argb: 'FF1E293B' },
                            bold: true
                        };
                        resignedTitleRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', wrapText: false };
                        
                        for (let i = 1; i <= 12; i++) {
                            const cell = resignedTitleRow.getCell(i);
                            cell.border = {
                                top: { style: 'medium', color: { argb: 'FF64748B' } },
                                bottom: { style: 'medium', color: { argb: 'FF64748B' } },
                                left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
                                right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
                            };
                        }

                        renderListToSheet(resignedList);
                    }
                    
                    // 열 너비 계산 및 자동 지정 (증권번호 열은 18로 고정)
                    worksheet.columns.forEach((column) => {
                        if (column.number === 5) {
                            column.width = 18;
                            return;
                        }
                        let maxLen = 10;
                        column.eachCell({ includeEmpty: false }, (cell) => {
                            const row = worksheet.getRow(cell.row);
                            const firstVal = String(row.getCell(1).value || '');
                            // 구분선 행(병합된 행) 및 해촉자 타이틀 행은 열 너비 계산에서 제외
                            if ((firstVal.includes('(') && firstVal.includes(')')) || firstVal.startsWith('■')) {
                                return;
                            }
                            
                            const valStr = String(cell.value || '');
                            let len = 0;
                            for (let i = 0; i < valStr.length; i++) {
                                len += valStr.charCodeAt(i) > 128 ? 2 : 1;
                            }
                            if (len > maxLen) maxLen = len;
                        });
                        column.width = Math.min(Math.max(maxLen + 3, 10), 45);
                    });
                    
                    // 증권번호 열(5번) 너비 18 고정 보장
                    worksheet.getColumn(5).width = 18;
                    
                    const baseTypeName = state.lapseBaseType === 'collector' ? '수금인' : '모집인';
                    const fileName = `실효연체관리_${baseTypeName}기준_전체_${new Date().toISOString().substring(0, 10)}.xlsx`;
                    
                    const data = await workbook.xlsx.writeBuffer();
                    const blob = new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
                    const url = window.URL.createObjectURL(blob);
                    const anchor = document.createElement('a');
                    anchor.href = url;
                    anchor.download = fileName;
                    anchor.click();
                    window.URL.revokeObjectURL(url);
                } catch (e) {
                    showLoading(false);
                    console.error(e);
                    alert('엑셀 다운로드 중 오류가 발생했습니다: ' + e.message);
                }
            });
        };

        // --- 7. Modals & Popups ---
        window.openDetail = function (k, t, customDetails = null, customTitle = null) {
            let d = [];
            if (customDetails) {
                d = customDetails.filter(x => x.category === k && x.type === t);
            } else {
                d = (state.data.rewardData?.details || []).filter(x => x.category === k && x.type === t);
            }

            document.body.classList.add('modal-open');
            const modal = document.createElement('div');
            modal.className = "fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 fade-in";

            const calcRate = (amt, prem) => {
                if (!prem || prem == 0) return '0%';
                return ((amt / prem) * 100).toFixed(1) + '%';
            };

            const isRefund = t === 'refund';

            // 합계 계산
            const totalAmt = d.reduce((sum, x) => sum + (x.amount || 0), 0);
            const totalColor = totalAmt >= 0 ? 'text-blue-600' : 'text-red-500';

            const desktopRows = d.length ? d.map(x => `
                    <tr class="border-b border-gray-100 hover:bg-gray-50 transition">
    <td class="p-3 font-medium text-gray-800 text-center bg-gray-50/50 border-r border-gray-100/50">${x.recruiter ||
                '-'}</td>
    <td class="p-3 text-gray-700">${x.company}</td>
    <td class="p-3 text-xs text-gray-500 font-mono">${maskPolicyNo(x.policyNo)}</td>
    <td class="p-3 font-medium text-gray-800">
        <div class="truncate-product" title="${x.product}">${x.product}</div>
    </td>
    <td class="p-3 text-xs text-gray-500">${x.date}</td>
    ${isRefund ? `<td class="p-3 text-xs text-gray-500 text-center font-mono">${x.payCount || '-'}</td>` : ''}
    <td class="p-3 text-right font-medium text-gray-700">${formatMoney(x.premium)}</td>
    <td class="p-3 text-center text-gray-700">${maskContractor(x.customer)}</td>
    <td class="p-3 text-right font-bold ${x.amount > 0 ? 'text-blue-600' : 'text-red-500'}">${formatMoney(x.amount)}
    </td>
    <td class="p-3 text-right text-xs bg-gray-50 font-mono text-gray-600">${calcRate(Math.abs(x.amount), x.premium)}
    </td>
    <td class="p-3 text-xs text-gray-500 max-w-[200px] truncate" title="${x.desc}">${x.desc}</td>
</tr>`).join('') : `<tr>
                    <td colspan="${isRefund ? 11 : 10}" class="p-8 text-center text-gray-500">내역이 없습니다.</td>
</tr>`;

            const mobileCards = d.length ? d.map(x => `
                    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-3 last:mb-0">
    <div class="flex justify-between items-start mb-2">
        <div>
            <p class="font-bold text-gray-900">${x.recruiter || '-'} <span
                    class="text-xs text-gray-400 font-normal">(${x.company})</span></p>
            <p class="text-xs text-gray-500 font-mono mt-0.5">${maskPolicyNo(x.policyNo)}</p>
        </div>
        <div class="text-right flex flex-col items-end">
            <span
                class="px-2 py-0.5 rounded-md text-[10px] font-bold ${x.amount > 0 ? 'bg-blue-50 text-blue-600 border border-blue-100' : 'bg-red-50 text-red-600 border border-red-100'} mb-1">${t
                    === 'pay' ? '지급' : '환수'} ${(x.amount > 0 && t === 'pay') || (x.amount < 0 && t !== 'pay') ? '' : '(주의)'
                }</span>
                    <p class="font-extrabold text-base ${x.amount > 0 ? 'text-blue-600' : 'text-red-500'}">
                        ${formatMoney(x.amount)}</p>
        </div>
    </div>
    <p class="text-sm text-gray-600 mb-2 font-medium truncate">${x.product}</p>
    <div class="grid grid-cols-2 gap-2 text-center text-xs bg-gray-50 rounded-xl p-2.5 mb-2">
        <div>
            <p class="text-gray-400 mb-0.5">보험료</p>
            <p class="font-semibold text-gray-700">${formatMoney(x.premium)}</p>
        </div>
        <div>
            <p class="text-gray-400 mb-0.5">시상금 비율</p>
            <p class="font-semibold text-gray-600">${calcRate(Math.abs(x.amount), x.premium)}</p>
        </div>
    </div>
    <div class="flex justify-between items-center mt-1 text-[11px] text-gray-400">
        <span>계약자: <span class="text-gray-600">${maskContractor(x.customer)}</span></span>
        ${isRefund ? `<span>납입회차: <span class="text-gray-600">${x.payCount || '-'}</span></span>` : ''}
        <span>계약일: <span class="text-gray-600">${x.date}</span></span>
    </div>
    <div class="mt-2 text-[11px] text-gray-500 bg-gray-50/50 p-2 rounded-lg border border-gray-100/50 truncate"
        title="${x.desc}">
        <span class="font-bold text-gray-400 mr-1">내용:</span>${x.desc}
    </div>
</div>`).join('') : '<div class="p-8 text-center text-gray-500 bg-gray-50 rounded-2xl">상세 내역이 없습니다.</div>';

            const titlePrefix = customTitle ? `<span class="text-gray-500 mr-2">[${customTitle}]</span>` : '';

            modal.innerHTML = `<div
                class="bg-gray-50 md:bg-white rounded-2xl shadow-2xl w-full max-w-6xl flex flex-col max-h-[90vh] md:max-h-[85vh] md:mt-0 overflow-hidden transform transition-all scale-100 ring-1 ring-black/5">
    <div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-white sticky top-0 z-20">
        <h3 class="font-bold text-base md:text-xl text-gray-800 flex items-center gap-2 md:gap-3">
            <span class="w-1.5 h-5 md:h-6 bg-primary rounded-full block shadow-sm"></span>
            <span class="truncate max-w-[150px] md:max-w-none">${titlePrefix}${k} <span
                    class="${t === 'pay' ? 'text-blue-600' : 'text-red-500'}">${t === 'pay' ? '지급' : '환수'}</span></span>
        </h3>
        <div class="flex items-center gap-3 md:gap-4">
            <div class="text-right">
                <div class="text-[10px] md:text-xs text-gray-400 font-medium tracking-tight">전체 합계</div>
                <div class="text-sm md:text-lg font-extrabold ${totalColor} tabular-nums">
                    ${Number(totalAmt).toLocaleString()}원</div>
            </div>
            <button
                class="close p-1.5 md:p-2 bg-gray-100 md:bg-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-full transition focus:outline-none"><svg
                    class="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12">
                    </path>
                </svg></button>
        </div>
    </div>

    <div class="overflow-y-auto flex-grow bg-gray-50 md:bg-white p-4 md:p-0">
        <!-- 데스크탑 테이블 뷰 -->
        <div class="hidden md:block">
            <table class="w-full text-sm whitespace-nowrap">
                <thead class="bg-gray-100/80 sticky top-0 z-10 shadow-sm backdrop-blur-sm">
                    <tr class="text-left text-gray-600">
                        <th class="p-3 font-semibold text-center text-gray-800 bg-gray-100 border-r border-gray-200">모집인
                        </th>
                        <th class="p-3 font-semibold">보험사</th>
                        <th class="p-3 font-semibold">증권번호</th>
                        <th class="p-3 font-semibold">상품명</th>
                        <th class="p-3 font-semibold">계약일</th>
                        ${isRefund ? `<th class="p-3 font-semibold text-center">납입회차</th>` : ''}
                        <th class="p-3 text-right font-semibold">보험료</th>
                        <th class="p-3 text-center font-semibold">계약자</th>
                        <th class="p-3 text-right font-semibold">보험사시상</th>
                        <th class="p-3 text-right font-semibold">시상률(%)</th>
                        <th class="p-3 font-semibold">시상내용</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">${desktopRows}</tbody>
            </table>
        </div>

        <!-- 모바일 카드 뷰 -->
        <div class="md:hidden flex flex-col">
            ${mobileCards}
        </div>
    </div>

    <div class="p-4 bg-white border-t border-gray-100 hidden md:block text-right">
        <button
            class="close px-6 py-2.5 bg-gray-800 hover:bg-gray-900 text-white font-medium rounded-xl shadow-lg shadow-gray-200 transition">닫기</button>
    </div>
</div>`;
            document.body.appendChild(modal);
            modal.querySelectorAll('.close').forEach(b => b.onclick = () => {
                document.body.classList.remove('modal-open');
                modal.remove();
            });
        }

        // 지사대표 대시보드 - 기타 수수료 / 세후지급공제 상세 모달
        window.openBranchEtcDetail = function (cardType, filterType) {
            const cardTitle = cardType === 'otherComm' ? '기타 수수료 (세전)' : '기타 지급 및 공제 (세후)';
            const typeLabel = filterType === 'pay' ? '지급' : '환수';
            const rawList = (cardType === 'otherComm'
                ? state.data.branchCommData?.otherCommList
                : state.data.branchCommData?.afterTaxList) || [];

            const list = rawList.filter(item => item.type === filterType);
            const totalAmt = list.reduce((sum, x) => sum + (x.amount || 0), 0);
            const totalColor = totalAmt >= 0 ? 'text-blue-600' : 'text-red-500';

            document.body.classList.add('modal-open');
            const modal = document.createElement('div');
            modal.className = "fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 fade-in";

            const desktopRows = list.length ? list.map(x => `
                <tr class="border-b border-gray-100 hover:bg-gray-50 transition">
                    <td class="p-3 text-center text-xs text-gray-500 font-mono">${x.month}</td>
                    <td class="p-3 text-center text-sm font-semibold text-gray-700 bg-gray-50/50">${x.statementType || '-'}</td>
                    <td class="p-3 text-left text-sm text-gray-800">${x.itemDesc || '-'}</td>
                    <td class="p-3 text-right text-sm font-bold ${x.amount < 0 ? 'text-red-500' : 'text-blue-600'}">${formatMoney(x.amount)}</td>
                </tr>
            `).join('') : `<tr><td colspan="4" class="p-8 text-center text-gray-400">데이터가 없습니다.</td></tr>`;

            const mobileCards = list.length ? list.map(x => `
                <div class="bg-white rounded-xl border border-gray-100 p-3.5 shadow-sm mb-2.5 last:mb-0">
                    <div class="flex justify-between items-center mb-1.5">
                        <span class="text-xs px-2 py-0.5 bg-gray-100 text-gray-700 rounded font-medium">${x.statementType || '일반'}</span>
                        <span class="text-xs text-gray-400 font-mono">${x.month}</span>
                    </div>
                    <p class="text-sm font-semibold text-gray-800 mb-1.5">${x.itemDesc || '-'}</p>
                    <div class="text-right">
                        <span class="text-base font-bold ${x.amount < 0 ? 'text-red-500' : 'text-blue-600'}">${formatMoney(x.amount)}</span>
                    </div>
                </div>
            `).join('') : `<div class="p-6 text-center text-gray-400">데이터가 없습니다.</div>`;

            modal.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[85vh] overflow-hidden ring-1 ring-black/5 animate-scale-up">
                <div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 sticky top-0 z-10">
                    <div>
                        <h3 class="font-bold text-lg md:text-xl text-gray-800 flex items-center gap-2">
                            <span class="w-1.5 h-5 bg-primary rounded-full block"></span>
                            ${cardTitle} - <span class="${filterType === 'pay' ? 'text-blue-600' : 'text-red-500'}">${typeLabel}</span> 상세내역
                        </h3>
                        <p class="text-xs text-gray-500 mt-0.5">${state.currentMonth} 마감월 (총 <span class="text-primary font-bold">${list.length}</span>건)</p>
                    </div>
                    <button class="close p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition focus:outline-none">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>

                <div class="overflow-y-auto flex-grow p-4 md:p-6">
                    <!-- 데스크탑 테이블 -->
                    <div class="hidden md:block border border-gray-100 rounded-xl overflow-hidden shadow-sm">
                        <table class="w-full text-sm">
                            <thead class="bg-gray-50 text-gray-600 border-b border-gray-100 text-xs font-semibold">
                                <tr>
                                    <th class="p-3 text-center">마감월</th>
                                    <th class="p-3 text-center">명세서구분</th>
                                    <th class="p-3 text-left">항목설명</th>
                                    <th class="p-3 text-right">지급금액</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-gray-100">
                                ${desktopRows}
                            </tbody>
                        </table>
                    </div>

                    <!-- 모바일 카드 -->
                    <div class="md:hidden flex flex-col">
                        ${mobileCards}
                    </div>
                </div>

                <div class="p-4 bg-gray-50/80 border-t border-gray-100 flex justify-between items-center px-6">
                    <span class="text-sm font-bold text-gray-600">합계</span>
                    <span class="text-lg font-extrabold ${totalColor} tabular-nums">${formatMoney(totalAmt)}</span>
                </div>
            </div>`;

            document.body.appendChild(modal);
            modal.querySelectorAll('.close').forEach(b => b.onclick = () => {
                document.body.classList.remove('modal-open');
                modal.remove();
            });
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    document.body.classList.remove('modal-open');
                    modal.remove();
                }
            });
        };
        // ==========================================
        // 지사대표 마감 처리 및 상태 관리
        // ==========================================
        window.checkMonthClosingStatus = async function () {
            const badge = document.getElementById('branchMonthClosingBadge');
            const btn = document.getElementById('branchMonthClosingBtn');
            if (!badge || !btn) return;

            try {
                const res = await callApi('getMonthClosingStatus', state.currentMonth, state.user.staffId);
                if (res && res.success) {
                    state.isCurrentMonthClosed = !!res.isClosed;
                    state.currentMonthClosedAt = res.closedAt || '';

                    if (res.isClosed) {
                        badge.className = "text-xs px-2.5 py-1 rounded-full font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1";
                        badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span> 마감완료${res.closedAt ? ` (${res.closedAt.split(' ')[0]})` : ''}`;
                        btn.className = "text-xs px-3 py-1.5 rounded-lg font-bold transition shadow-xs bg-gray-100 hover:bg-gray-200 text-gray-600 border border-gray-300";
                        btn.textContent = "마감 취소";
                        btn.classList.remove('hidden');
                    } else {
                        badge.className = "text-xs px-2.5 py-1 rounded-full font-bold bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1";
                        badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block"></span> 미마감 (일반사용자 숨김)`;
                        btn.className = "text-xs px-3.5 py-1.5 rounded-lg font-bold transition shadow-xs bg-primary hover:bg-primary/90 text-white";
                        btn.textContent = "마감 하기";
                        btn.classList.remove('hidden');
                    }
                } else {
                    badge.textContent = "상태 조회 실패";
                    badge.classList.remove('animate-pulse');
                }
            } catch (e) {
                console.warn('Check month closing status error:', e);
            }
        };

        window.handleToggleMonthClosing = async function () {
            const btn = document.getElementById('branchMonthClosingBtn');
            const isCurrentlyClosed = !!state.isCurrentMonthClosed;
            const targetMonth = state.currentMonth;

            const confirmMsg = isCurrentlyClosed
                ? `[${targetMonth}월] 마감 처리를 '취소'하시겠습니까?\n\n※ 마감 취소 시 일반 사용자(위촉자 등)에게 해당 월의 데이터가 숨겨집니다.`
                : `[${targetMonth}월] 데이터를 '마감 하기' 처리하시겠습니까?\n\n※ 마감 처리 후 일반 사용자(위촉자 등)가 해당 월의 데이터를 조회할 수 있게 됩니다.`;

            if (!confirm(confirmMsg)) return;

            if (btn) {
                btn.disabled = true;
                btn.innerHTML = `<svg class="animate-spin w-3.5 h-3.5 inline mr-1" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> 처리중...`;
            }

            try {
                const res = await callApi('toggleMonthClosing', targetMonth, !isCurrentlyClosed, state.user.staffId);
                if (res && res.success) {
                    alert(res.message);
                    // 세션 캐시 무효화
                    sessionStorage.removeItem('APP_MONTH_LIST');
                    await checkMonthClosingStatus();
                } else {
                    alert(res.message || '마감 처리 중 오류가 발생했습니다.');
                    if (btn) btn.disabled = false;
                }
            } catch (e) {
                alert('서버 통신 오류가 발생했습니다: ' + e.message);
                if (btn) btn.disabled = false;
            }
        };

        // 시상금 판업 즉시 표시 후 데이터 로딩 (UX 개선)
        window.fetchAndShowAdminDetail = async function (id, name, category, type) {
            // 1. 팝업 즉시 표시 + 로딩 스피너
            document.body.classList.add('modal-open');
            const modal = document.createElement('div');
            modal.className = "fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 fade-in";
            const payLabel = type === 'pay' ? '지급' : '환수';
            const payColor = type === 'pay' ? 'text-blue-600' : 'text-red-500';
            modal.innerHTML = `<div
                class="bg-white rounded-2xl shadow-2xl w-full max-w-6xl flex flex-col max-h-[90vh] overflow-hidden ring-1 ring-black/5">
    <div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
        <h3 class="font-bold text-xl text-gray-800 flex items-center gap-3">
            <span class="w-1.5 h-6 bg-primary rounded-full block shadow-sm"></span>
            <span><span class="text-gray-500 mr-2">[${name}]</span>${category} <span
                    class="${payColor}">${payLabel}</span> 상세내역</span>
        </h3>
        <button class="close p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition"><svg
                class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg></button>
    </div>
    <div id="admin-detail-body" class="flex-grow flex items-center justify-center h-48">
        <div class="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
    </div>
    <div class="p-4 bg-gray-50 border-t border-gray-100 text-right">
        <button
            class="close px-6 py-2.5 bg-gray-800 hover:bg-gray-900 text-white font-medium rounded-xl shadow-lg shadow-gray-200 transition">닫기</button>
    </div>
</div>`;
            document.body.appendChild(modal);
            modal.querySelectorAll('.close').forEach(b => b.onclick = () => {
                document.body.classList.remove('modal-open');
                modal.remove();
            });

            // 2. 데이터 로드 (캐시 우선 확인)
            const cacheKey = `DATA_${id}_${state.currentMonth}_dashboard`;
            let d = null;
            const cached = sessionStorage.getItem(cacheKey);
            if (cached) {
                try { d = JSON.parse(cached); } catch (e) { }
            }
            if (!d) {
                d = await callApi('getRewardData', id, state.currentMonth);
                if (d && !d.error) {
                    d.month = state.currentMonth;
                    sessionStorage.setItem(cacheKey, JSON.stringify(d));
                }
            }

            const body = modal.querySelector('#admin-detail-body');
            if (!body) return;

            if (d && !d.error && d.details) {
                const details = d.details.filter(x => x.category === category && x.type === type);
                const totalAmt = details.reduce((sum, x) => sum + (x.amount || 0), 0);
                const totalColor = totalAmt >= 0 ? 'text-blue-600' : 'text-red-500';

                // 타이틀에 합계 추가
                const titleEl = modal.querySelector('h3');
                if (titleEl) {
                    titleEl.insertAdjacentHTML('afterend', `<div class="text-right">
    <div class="text-xs text-gray-400 font-medium">합계</div>
    <div class="text-lg font-extrabold ${totalColor} tabular-nums">${Number(totalAmt).toLocaleString()}원</div>
</div>`);
                    titleEl.closest('div').classList.add('justify-between');
                }

                const isRefund = type === 'refund';
                const calcRate = (amt, prem) => (!prem || prem == 0) ? '0%' : ((amt / prem) * 100).toFixed(1) + '%';

                const desktopRows = details.length ? details.map(x => `
                    <tr class="border-b border-gray-100 hover:bg-gray-50 transition">
    <td class="p-3 font-medium text-gray-800 text-center bg-gray-50/50 border-r border-gray-100/50">${x.recruiter ||
                    name}</td>
    <td class="p-3 text-gray-700">${x.company}</td>
    <td class="p-3 text-xs text-gray-500 font-mono">${maskPolicyNo(x.policyNo)}</td>
    <td class="p-3 font-medium text-gray-800">
        <div class="truncate-product" title="${x.product}">${x.product}</div>
    </td>
    <td class="p-3 text-xs text-gray-500">${x.date}</td>
    ${isRefund ? `<td class="p-3 text-xs text-gray-500 text-center font-mono">${x.payCount || '-'}</td>` : ''}
    <td class="p-3 text-right font-medium text-gray-700">${formatMoney(x.premium)}</td>
    <td class="p-3 text-center text-gray-700">${maskContractor(x.customer)}</td>
    <td class="p-3 text-right font-bold ${x.amount > 0 ? 'text-blue-600' : 'text-red-500'}">${formatMoney(x.amount)}
    </td>
    <td class="p-3 text-right text-xs bg-gray-50 font-mono text-gray-600">${calcRate(Math.abs(x.amount), x.premium)}
    </td>
    <td class="p-3 text-xs text-gray-500 max-w-[200px] truncate" title="${x.desc}">${x.desc}</td>
</tr>`).join('') : `<tr>
                    <td colspan="${isRefund ? 11 : 10}" class="p-8 text-center text-gray-500">내역이 없습니다.</td>
</tr>`;

                const mobileCards = details.length ? details.map(x => `
                    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-3 last:mb-0">
    <div class="flex justify-between items-start mb-2">
        <div>
            <p class="font-bold text-gray-900">${x.recruiter || name} <span
                    class="text-xs text-gray-400 font-normal">(${x.company})</span></p>
            <p class="text-xs text-gray-500 font-mono mt-0.5">${maskPolicyNo(x.policyNo)}</p>
        </div>
        <div class="text-right flex flex-col items-end">
            <span
                class="px-2 py-0.5 rounded-md text-[10px] font-bold ${x.amount > 0 ? 'bg-blue-50 text-blue-600 border border-blue-100' : 'bg-red-50 text-red-600 border border-red-100'} mb-1">${type
                        === 'pay' ? '지급' : '환수'} ${(x.amount > 0 && type === 'pay') || (x.amount < 0 && type !== 'pay') ? ''
                            : '(주의)'}</span>
                    <p class="font-extrabold text-base ${x.amount > 0 ? 'text-blue-600' : 'text-red-500'}">
                        ${formatMoney(x.amount)}</p>
        </div>
    </div>
    <p class="text-sm text-gray-600 mb-2 font-medium truncate">${x.product}</p>
    <div class="grid grid-cols-2 gap-2 text-center text-xs bg-gray-50 rounded-xl p-2.5 mb-2">
        <div>
            <p class="text-gray-400 mb-0.5">보험료</p>
            <p class="font-semibold text-gray-700">${formatMoney(x.premium)}</p>
        </div>
        <div>
            <p class="text-gray-400 mb-0.5">시상금 비율</p>
            <p class="font-semibold text-gray-600">${calcRate(Math.abs(x.amount), x.premium)}</p>
        </div>
    </div>
    <div class="flex justify-between items-center mt-1 text-[11px] text-gray-400">
        <span>계약자: <span class="text-gray-600">${maskContractor(x.customer)}</span></span>
        ${isRefund ? `<span>납입회차: <span class="text-gray-600">${x.payCount || '-'}</span></span>` : ''}
        <span>계약일: <span class="text-gray-600">${x.date}</span></span>
    </div>
    <div class="mt-2 text-[11px] text-gray-500 bg-gray-50/50 p-2 rounded-lg border border-gray-100/50 truncate"
        title="${x.desc}">
        <span class="font-bold text-gray-400 mr-1">내용:</span>${x.desc}
    </div>
</div>`).join('') : '<div class="p-8 text-center text-gray-500 bg-gray-50 rounded-2xl">상세 내역이 없습니다.</div>';

                body.outerHTML = `<div class="overflow-y-auto flex-grow bg-gray-50 md:bg-white p-4 md:p-0">
    <!--데스크탑 테이블 뷰-->
    <div class="hidden md:block">
        <table class="w-full text-sm whitespace-nowrap">
            <thead class="bg-gray-100/80 sticky top-0 z-10 shadow-sm backdrop-blur-sm">
                <tr class="text-left text-gray-600">
                    <th class="p-3 font-semibold text-center text-gray-800 bg-gray-100 border-r border-gray-200">모집인
                    </th>
                    <th class="p-3 font-semibold">보험사</th>
                    <th class="p-3 font-semibold">증권번호</th>
                    <th class="p-3 font-semibold">상품명</th>
                    <th class="p-3 font-semibold">계약일</th>
                    ${isRefund ? `<th class="p-3 font-semibold text-center">납입회차</th>` : ''}
                    <th class="p-3 text-right font-semibold">보험료</th>
                    <th class="p-3 text-center font-semibold">계약자</th>
                    <th class="p-3 text-right font-semibold">보험사시상</th>
                    <th class="p-3 text-right font-semibold">시상률(%)</th>
                    <th class="p-3 font-semibold">시상내용</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">${desktopRows}</tbody>
        </table>
    </div>

    <!--모바일 카드 뷰-->
                    <div class="md:hidden flex flex-col">
                        ${mobileCards}
                    </div>
</div>`;
            } else {
                body.innerHTML = `<div class="p-8 text-center text-red-500">오류: ${(d && d.message) || '데이터를 불러올 수 없습니다.'}</div>`;
            }
        };

        // 수수료 판업 즉시 표시 후 데이터 로딩 (UX 개선)
        window.fetchAndShowCommissionAdminDetail = async function (targetId, targetName, commType, payType) {
            // 1. 팝업 즉시 표시 + 로딩 스피너
            document.body.classList.add('modal-open');
            const modal = document.createElement('div');
            modal.className = "fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 fade-in";
            const typeLabel = commType === 'nl' ? '손보수수료' : commType === 'l' ? '생보수수료' : '관리수수료';
            const payLabel = payType === 'pay' ? '지급' : '환수';
            const colorClass = payType === 'pay' ? 'blue' : 'red';
            modal.innerHTML = `<div
                class="bg-white rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col max-h-[90vh] overflow-hidden ring-1 ring-black/5">
    <div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
        <h3 class="font-bold text-xl text-gray-800 flex items-center gap-3">
            <span class="w-1.5 h-6 bg-${colorClass}-400 rounded-full block shadow-sm"></span>
            <span>[${targetName}] ${typeLabel} <span
                    class="text-${colorClass === 'blue' ? 'blue-600' : 'red-500'}">${payLabel}</span> 상세내역</span>
        </h3>
        <button class="close p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition"><svg
                class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg></button>
    </div>
    <div id="comm-detail-body" class="flex-grow flex items-center justify-center h-48">
        <div class="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
    </div>
    <div class="p-4 bg-gray-50 border-t border-gray-100 text-right">
        <button
            class="close px-6 py-2.5 bg-gray-800 hover:bg-gray-900 text-white font-medium rounded-xl shadow-lg shadow-gray-200 transition">닫기</button>
    </div>
</div>`;
            document.body.appendChild(modal);
            modal.querySelectorAll('.close').forEach(b => b.onclick = () => {
                document.body.classList.remove('modal-open');
                modal.remove();
            });

            // 2. 데이터 로드 (캐시 우선 확인)
            const cacheKey = `DATA_COMM_${targetId}_${state.currentMonth}_${commType}_${payType}`;
            let res = null;
            const cached = sessionStorage.getItem(cacheKey);
            if (cached) {
                try { res = JSON.parse(cached); } catch (e) { }
            }
            if (!res) {
                res = await callApi('getBranchMemberCommissionDetails', state.user.staffId, targetId, state.currentMonth, commType,
                    payType);
                if (res && res.success && !res.error) {
                    sessionStorage.setItem(cacheKey, JSON.stringify(res));
                }
            }

            const body = modal.querySelector('#comm-detail-body');
            if (!body) return;

            if (res.error || !res.success) {
                body.innerHTML = `<div class="p-8 text-center text-red-500">수수료 내역을 불러오지 못했습니다: ${res.message || '알 수 없는 오류'}</div>`;
                return;
            }

            const list = res.list || [];
            const totalAmt = list.reduce((sum, x) => sum + (x.amount || 0), 0);
            const totalColor = totalAmt >= 0 ? 'text-blue-600' : 'text-red-500';

            // 타이틀에 합계 및 건수 추가
            const headerDiv = modal.querySelector('.justify-between') || modal.querySelector('.flex.justify-between');
            if (headerDiv) {
                const btn = headerDiv.querySelector('.close');
                const summaryHtml = `<div class="flex items-center gap-4 mr-2">
                    <div class="text-right">
                        <div class="text-xs text-gray-400 font-medium">합계 (${list.length}건)</div>
                        <div class="text-lg font-extrabold ${totalColor} tabular-nums">${Number(totalAmt).toLocaleString()}원</div>
                    </div>
</div>`;
                btn.insertAdjacentHTML('beforebegin', summaryHtml);
            }

            const isRefund = payType === 'refund';
            const rows = list.length ? list.map(x => `
                    <tr class="border-b border-gray-100 hover:bg-gray-50 transition">
    <td class="p-3 text-gray-700">${x.company}</td>
    <td class="p-3 text-xs text-gray-500 font-mono">${x.policyNo}</td>
    <td class="p-3 font-medium text-gray-800">
        <div class="truncate-product" title="${x.product}">${x.product}</div>
    </td>
    <td class="p-3 text-xs text-gray-500">${x.date}</td>
    ${isRefund ? `<td class="p-3 text-xs text-gray-500 text-center font-mono">${x.payCount || '-'}</td>` : ''}
    <td class="p-3 text-right font-medium text-gray-700">${formatMoney(x.premium)}</td>
    <td class="p-3 text-center text-gray-700">${x.customer}</td>
    <td class="p-3 text-right font-bold ${x.amount > 0 ? 'text-blue-600' : 'text-red-500'}">${formatMoney(x.amount)}
    </td>
    <td class="p-3 text-xs text-gray-500 max-w-[200px] truncate" title="${x.contractStatus}">${x.contractStatus}</td>
</tr>`).join('') : `<tr>
                    <td colspan="${isRefund ? 9 : 8}" class="p-8 text-center text-gray-500">내역이 없습니다.</td>
</tr>`;

            const mobileCards = list.length ? list.map(x => `
                <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-3 last:mb-0">
                    <div class="flex justify-between items-start mb-2">
                        <div>
                            <p class="font-bold text-gray-900">${x.company}</p>
                            <p class="text-xs text-gray-500 font-mono mt-0.5">${x.policyNo}</p>
                        </div>
                        <div class="text-right flex flex-col items-end">
                            <span class="px-2 py-0.5 rounded-md text-[10px] font-bold ${x.amount > 0 ? 'bg-blue-50 text-blue-600 border border-blue-100' : 'bg-red-50 text-red-600 border border-red-100'} mb-1">${payLabel}</span>
                            <p class="font-extrabold text-base ${x.amount > 0 ? 'text-blue-600' : 'text-red-500'}">${formatMoney(x.amount)}</p>
                        </div>
                    </div>
                    <p class="text-sm text-gray-600 mb-2 font-medium truncate">${x.product}</p>
                    <div class="grid grid-cols-2 gap-2 text-center text-xs bg-gray-50 rounded-xl p-2.5 mb-2">
                        <div>
                            <p class="text-gray-400 mb-0.5">보험료</p>
                            <p class="font-semibold text-gray-700">${formatMoney(x.premium)}</p>
                        </div>
                        <div>
                            <p class="text-gray-400 mb-0.5">계약자</p>
                            <p class="font-semibold text-gray-600">${x.customer}</p>
                        </div>
                    </div>
                    <div class="flex justify-between items-center mt-1 text-[11px] text-gray-400">
                        <span>계약일: <span class="text-gray-600">${x.date}</span></span>
                        ${isRefund ? `<span>납입회차: <span class="text-gray-600">${x.payCount || '-'}</span></span>` : ''}
                        <span>계약상태: <span class="text-gray-600">${x.contractStatus}</span></span>
                    </div>
                </div>`).join('') : '<div class="p-8 text-center text-gray-500 bg-gray-50 rounded-2xl">상세 내역이 없습니다.</div>';

            body.outerHTML = `<div class="overflow-y-auto flex-grow bg-gray-50 md:bg-white p-4 md:p-0">
                    <div class="hidden md:block">
                        <table class="w-full text-sm whitespace-nowrap">
                            <thead class="bg-gray-100/80 sticky top-0 z-10 shadow-sm backdrop-blur-sm">
                                <tr class="text-left text-gray-600">
                                    <th class="p-3 font-semibold">보험사</th>
                                    <th class="p-3 font-semibold">증권번호</th>
                                    <th class="p-3 font-semibold">상품명</th>
                                    <th class="p-3 font-semibold">계약일</th>
                                    ${isRefund ? `<th class="p-3 font-semibold text-center">납입회차</th>` : ''}
                                    <th class="p-3 text-right font-semibold">보험료</th>
                                    <th class="p-3 text-center font-semibold">계약자</th>
                                    <th class="p-3 text-right font-semibold">수수료</th>
                                    <th class="p-3 font-semibold">계약상태</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-gray-100">${rows}</tbody>
                        </table>
                    </div>
                    <div class="md:hidden flex flex-col">
                        ${mobileCards}
                    </div>
</div>`;
        };

        window.fetchAndShowOrgTree = async function (targetId, targetName) {
            showLoading(true);
            const res = await callApi('getOrgTree', state.user.staffId, targetId, state.currentMonth);
            showLoading(false);

            if (res.error) {
                alert('오류: ' + res.message);
            } else {
                showOrgTreeModal(res.data, targetName);
            }
        };

        window.showOrgTreeModal = function (data, targetName) {
            document.body.classList.add('modal-open');
            const modal = document.createElement('div');
            modal.className = "fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 fade-in";

            // Build Tree Logic
            const list = data.downlines || [];
            // Sort to ensure hierarchy (this does not guarantee full tree order but helps if sorted by levels)
            // Better approach: Reconstruct tree

            const buildTree = () => {
                const nodeMap = {};
                list.forEach(n => nodeMap[String(n['사번'])] = { ...n, children: [] });

                const hierarchy = [];

                list.forEach(n => {
                    if (n.level === 1) {
                        hierarchy.push(nodeMap[String(n['사번'])]);
                    } else {
                        // For levels > 1, parent is always the direct upline (상위1차)
                        const parentId = String(n['상위1차']);

                        if (nodeMap[parentId]) {
                            nodeMap[parentId].children.push(nodeMap[String(n['사번'])]);
                        } else {
                            // Orphaned node (parent missing from list)?
                            // Add to root level to ensure visibility
                            hierarchy.push(nodeMap[String(n['사번'])]);
                        }
                    }
                });
                return hierarchy;
            };

            const tree = buildTree();

            // Render Function
            const renderNode = (node) => {
                const pay = (Number(node['손보월발생분'] || 0) + Number(node['생보월발생분'] || 0));
                const ref = (Number(node['손보월환수분'] || 0) + Number(node['생보월환수분'] || 0));
                const net = pay + ref;
                const netClass = net >= 0 ? 'text-blue-600' : 'text-red-500';

                let html = `
                    <div class="mb-2">
                        <div
                            class="flex items-center p-3 bg-gray-50 rounded-xl hover:bg-white hover:shadow-md transition border border-gray-100/50">
                            <div class="flex-shrink-0 mr-3">
                                <div
                                    class="w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center text-xs font-bold text-gray-500 shadow-sm">
                                    ${node.level}차</div>
                            </div>
                            <div class="flex-grow min-w-0">
                                <p class="text-sm font-bold text-gray-800 truncate">${node['이름']} <span
                                    class="text-gray-400 font-normal text-xs">(${node['사번']})</span></p>
                                <p class="text-xs text-gray-500 truncate">${node['소속'] || ''} | ${node['직책'] || ''} | ${node['위촉월'] || ''}
                                </p>
                            </div>
                            <div class="flex-shrink-0 text-right ml-3">
                                <p class="text-sm font-bold ${netClass}">${formatMoney(net)}</p>
                                <p class="text-[10px] text-gray-400">지급 ${formatMoney(pay)} / 환수 ${formatMoney(ref)}</p>
                            </div>
                        </div>
                `;

                if (node.children && node.children.length > 0) {
                    html += `<div class="ml-6 pl-4 border-l-2 border-gray-100 mt-2 space-y-2">`;
                    node.children.forEach(child => {
                        html += renderNode(child);
                    });
                    html += `</div>`;
                }

                html += `
</div>`;
                return html;
            };

            let contentHtml = '';
            if (tree.length === 0) contentHtml = '<div class="text-center py-10 text-gray-400">산하 조직이 없습니다.</div>';
            else tree.forEach(node => contentHtml += renderNode(node));

            modal.innerHTML = `
                    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[85vh] overflow-hidden">
    <div
        class="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/80 backdrop-blur-md sticky top-0 z-10">
        <h3 class="font-bold text-lg text-gray-800 flex items-center gap-2">
            <span class="p-1.5 bg-blue-100 text-blue-600 rounded-lg"><svg class="w-5 h-5" fill="none"
                    stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10">
                    </path>
                </svg></span>
            <span>${targetName} <span class="text-gray-400 font-normal text-sm">산하 조직도</span></span>
        </h3>
        <button class="close p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition"><svg
                class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg></button>
    </div>
    <div class="p-6 overflow-y-auto bg-white custom-scrollbar">
        ${contentHtml}
    </div>
    <div class="p-4 bg-gray-50 border-t border-gray-100 text-right">
        <button
            class="close px-6 py-2.5 bg-gray-800 hover:bg-gray-900 text-white font-medium rounded-xl shadow-lg shadow-gray-200 transition">닫기</button>
    </div>
</div>
                    `;

            document.body.appendChild(modal);
            modal.querySelectorAll('.close').forEach(b => b.onclick = () => {
                document.body.classList.remove('modal-open');
                modal.remove();
            });
        };

        window.fetchAndShowLapsedContracts = async function () {
            const cacheKey = `DATA_MY_LAPSED_${state.user.staffId}`;
            let cached = sessionStorage.getItem(cacheKey);
            let res = null;
            if (cached) { try { res = JSON.parse(cached); } catch (e) { } }

            if (!res) {
                showLoading(true);
                res = await callApi('getLapsedContracts', state.user.staffId);
                showLoading(false);
                if (res && !res.error && res.success) {
                    sessionStorage.setItem(cacheKey, JSON.stringify(res));
                }
            }

            if (res && (res.error || !res.success)) {
                alert('오류: ' + (res.message || '데이터를 불러오지 못했습니다.'));
            } else {
                showLapsedContractsModal(res.list || [], "나의 ");
            }
        };

        window.showLapsedContractsModal = function (data, prefix = "") {
            document.body.classList.add('modal-open');
            const modal = document.createElement('div');
            modal.className = "fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 fade-in";

            const rows = data.length > 0 ? data.map(x => `
                    <tr class="border-b border-gray-100 hover:bg-gray-50 transition">
    <td class="p-3 text-center">
        <span
            class="px-2 py-1 text-[10px] font-bold rounded-lg ${String(x['계약상태']).includes('실효') ? 'bg-red-50 text-red-600 border border-red-100' : (String(x['계약상태']).includes('연체') ? 'bg-orange-50 text-orange-600 border border-orange-100' : 'bg-gray-100 text-gray-600')}">${x['계약상태']}</span>
    </td>
    <td class="p-3 text-center text-gray-700">${x['모집인명']}</td>
    <td class="p-3 text-center font-bold text-gray-800">${x['수금인명']}</td>
    <td class="p-3 text-gray-700">${x['보험사']}</td>
    <td class="p-3 text-xs text-gray-500 font-mono">${maskPolicyNo(x['증권번호'])}</td>
    <td class="p-3 font-medium text-gray-800">
        <div class="truncate-product" title="${x['상품명']}">${x['상품명']}</div>
    </td>
    <td class="p-3 text-right font-medium text-blue-600">${formatMoney(x['계속보험료'])}</td>
    <td class="p-3 text-xs text-gray-500">${formatLapseDate(x['계약일'])}</td>
    <td class="p-3 text-center text-xs text-gray-600">${x['납입회차']}</td>
    <td class="p-3 text-center text-xs bg-gray-50 text-gray-500 font-mono">${x['최종납입월']}</td>
    <td class="p-3 text-center font-medium text-gray-700">${x['계약자']}</td>
    <td class="p-3 text-center text-xs text-gray-500 font-mono">${formatLapseDate(x['데이터기준일'])}</td>
</tr>`).join('') : `<tr>
                    <td colspan="12" class="p-8 text-center text-gray-500">실효 계약 내역이 없습니다. (조회 기준일에 따라 다를 수 있습니다)</td>
</tr>`;

            const mobileCards = data.length > 0 ? data.map(x => `
                    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-3 last:mb-0">
    <div class="flex justify-between items-start mb-2">
        <div>
            <p class="font-bold text-gray-900">${x['계약자']} <span
                    class="text-xs text-gray-400 font-normal">(${x['모집인명']})</span></p>
            <p class="text-xs text-gray-500 font-mono mt-0.5">${maskPolicyNo(x['증권번호'])}</p>
        </div>
        <div class="text-right flex flex-col items-end">
            <span
                class="px-2 py-0.5 rounded-md text-[10px] font-bold ${String(x['계약상태']).includes('실효') ? 'bg-red-50 text-red-600 border border-red-100' : (String(x['계약상태']).includes('연체') ? 'bg-orange-50 text-orange-600 border border-orange-100' : 'bg-gray-100 text-gray-600')} mb-1">${x['계약상태']}</span>
            <p class="font-extrabold text-base text-blue-600">${formatMoney(x['계속보험료'])}</p>
        </div>
    </div>
    <p class="text-sm text-gray-600 mb-2 font-medium truncate">${x['상품명']}</p>
    <div class="grid grid-cols-2 gap-2 text-center text-xs bg-gray-50 rounded-xl p-2.5 mb-2">
        <div>
            <p class="text-gray-400 mb-0.5">계약일</p>
            <p class="font-semibold text-gray-700">${formatLapseDate(x['계약일'])}</p>
        </div>
        <div>
            <p class="text-gray-400 mb-0.5">최종납입월/회차</p>
            <p class="font-semibold text-gray-600">${x['최종납입월']} (${x['납입회차']})</p>
        </div>
    </div>
    <div class="flex justify-between items-center mt-2 text-[11px] text-gray-400">
        <span>수금인: <span class="text-gray-600">${x['수금인명']}</span></span>
        <span>보험사: <span class="text-gray-600">${x['보험사']}</span></span>
    </div>
    <div class="text-[11px] text-gray-400 mt-1 text-right">
        기준일: <span class="text-gray-600 font-mono">${formatLapseDate(x['데이터기준일'])}</span>
    </div>
</div>`).join('') : '<div class="p-8 text-center text-gray-500 bg-gray-50 rounded-2xl">실효 계약 내역이 없습니다.</div>';

            modal.innerHTML = `<div
                class="bg-gray-50 md:bg-white rounded-2xl shadow-2xl w-full max-w-7xl flex flex-col max-h-[90vh] md:max-h-[85vh] md:mt-0 overflow-hidden transform transition-all scale-100 ring-1 ring-black/5">
    <div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-white sticky top-0 z-20">
        <h3 class="font-bold text-base md:text-xl text-gray-800 flex items-center gap-2 md:gap-3">
            <span class="w-1.5 h-5 md:h-6 bg-red-500 rounded-full block shadow-sm"></span>
            <span class="truncate max-w-[200px] md:max-w-none">${prefix}실효계약 <span
                    class="text-sm font-normal text-gray-500 ml-2">(총 <span
                        class="text-red-500 font-bold">${data.length}</span>건)</span></span>
        </h3>
        <button
            class="close p-1.5 md:p-2 bg-gray-100 md:bg-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-full transition focus:outline-none"><svg
                class="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg></button>
    </div>

    <div class="overflow-y-auto flex-grow bg-gray-50 md:bg-white p-4 md:p-0">
        <!-- 데스크탑 테이블 뷰 -->
        <div class="hidden md:block">
            <table class="w-full text-sm whitespace-nowrap min-w-[1000px]">
                <thead class="bg-gray-100/80 sticky top-0 z-10 shadow-sm backdrop-blur-sm">
                    <tr class="text-left text-gray-600">
                        <th class="p-3 font-semibold text-center">상태</th>
                        <th class="p-3 font-semibold text-center">모집인</th>
                        <th class="p-3 font-semibold text-center text-gray-800">수금인</th>
                        <th class="p-3 font-semibold">보험사</th>
                        <th class="p-3 font-semibold">증권번호</th>
                        <th class="p-3 font-semibold">상품명</th>
                        <th class="p-3 text-right font-semibold">계속보험료</th>
                        <th class="p-3 font-semibold">계약일</th>
                        <th class="p-3 text-center font-semibold">납입회차</th>
                        <th class="p-3 text-center font-semibold">최종납입월</th>
                        <th class="p-3 text-center font-semibold">계약자</th>
                        <th class="p-3 text-center font-semibold">데이터기준일</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">${rows}</tbody>
            </table>
        </div>

        <!-- 모바일 카드 뷰 -->
        <div class="md:hidden flex flex-col">
            ${mobileCards}
        </div>
    </div>

    <div class="p-4 bg-white border-t border-gray-100 hidden md:block text-right">
        <button
            class="close px-6 py-2.5 bg-gray-800 hover:bg-gray-900 text-white font-medium rounded-xl shadow-lg shadow-gray-200 transition">닫기</button>
    </div>
</div>`;
            document.body.appendChild(modal);
            modal.querySelectorAll('.close').forEach(b => b.onclick = () => {
                document.body.classList.remove('modal-open');
                modal.remove();
            });
        };

        function createBondAdminView() {
            if (state.isLoading && !state.bondLoaded) return getSkeletonUI();
            const div = document.createElement('div');

            if (!state.bondData || state.bondDataMonth !== state.currentMonth) {
                state.bondLoaded = false;
                setTimeout(async () => {
                    const res = await callApi('getBondManagementData', state.user.staffId, state.bondTargetMonth || '');
                    if (res.error || !res.success) {
                        alert(res.message || '채권관리 데이터를 불러오지 못했습니다.');
                        state.bondLoaded = true;
                        render();
                        return;
                    }
                    state.bondData = res.list || [];
                    state.bondTargetMonth = res.month || '';
                    state.bondDataMonth = state.currentMonth;
                    state.bondUpdates = {};
                    state.bondLoaded = true;
                    render();
                }, 10);
                return getSkeletonUI();
            }

            const list = state.bondData || [];

            // Summary 계산 (전체 list 기준)
            const totalActiveCount = list.length;
            const needIncreaseCount = list.filter(u => {
                const bond = state.bondUpdates[u.id] !== undefined ? state.bondUpdates[u.id] : u.bond;
                const a3m = Math.round(bond * 1.3);
                const rn3 = u.allowance3m > a3m ? u.allowance3m - a3m : 0;
                const rn6 = u.allowance6m > bond ? u.allowance6m - bond : 0;
                const rn9 = u.allowance9m > bond ? u.allowance9m - bond : 0;
                const rn12 = u.allowance12m > bond ? u.allowance12m - bond : 0;
                return rn3 > 0 || rn6 > 0 || rn9 > 0 || rn12 > 0;
            }).length;
            const totalNeedIncreaseAmt = list.reduce((sum, u) => {
                const bond = state.bondUpdates[u.id] !== undefined ? state.bondUpdates[u.id] : u.bond;
                const a3m = Math.round(bond * 1.3);
                const rn3 = u.allowance3m > a3m ? u.allowance3m - a3m : 0;
                const rn6 = u.allowance6m > bond ? u.allowance6m - bond : 0;
                const rn9 = u.allowance9m > bond ? u.allowance9m - bond : 0;
                const rn12 = u.allowance12m > bond ? u.allowance12m - bond : 0;
                return sum + Math.max(rn3, rn6, rn9, rn12);
            }, 0);
            const totalBondAmt = list.reduce((sum, u) => sum + (state.bondUpdates[u.id] !== undefined ? state.bondUpdates[u.id] : u.bond), 0);
            const avgBondAmt = totalActiveCount > 0 ? Math.round(totalBondAmt / totalActiveCount) : 0;

            div.innerHTML = `
                <div class="mb-6 flex flex-col gap-2">
                    <h2 class="text-xl font-bold text-gray-800 tracking-tight">채권 담보 증액 체크</h2>
                    <p class="text-gray-500 text-xs">최근 12개월의 월 총수당(수수료+시상금)을 기반으로 보유채권의 적정성을 평가하고 증액 필요금액을 도출합니다.</p>
                </div>

                <!-- 상단 요약 카드 -->
                <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                    <div class="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4">
                        <div class="p-3 bg-blue-50 text-blue-600 rounded-xl">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                        </div>
                        <div>
                            <p class="text-xs text-gray-400 font-bold">대상 위촉자</p>
                            <p class="text-lg font-extrabold text-gray-900 mt-0.5">${totalActiveCount}명</p>
                        </div>
                    </div>
                    <div class="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4">
                        <div class="p-3 bg-rose-50 text-rose-600 rounded-xl">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                        </div>
                        <div>
                            <p class="text-xs text-gray-400 font-bold">담보 부족 인원</p>
                            <p class="text-lg font-extrabold text-rose-600 mt-0.5">${needIncreaseCount}명</p>
                        </div>
                    </div>
                    <div class="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4">
                        <div class="p-3 bg-amber-50 text-amber-600 rounded-xl">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        </div>
                        <div>
                            <p class="text-xs text-gray-400 font-bold">최대 증액필요액 계</p>
                            <p class="text-lg font-extrabold text-amber-600 mt-0.5">${formatMoney(totalNeedIncreaseAmt)}</p>
                        </div>
                    </div>
                    <div class="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4">
                        <div class="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>
                        </div>
                        <div>
                            <p class="text-xs text-gray-400 font-bold">인당 평균 채권</p>
                            <p class="text-lg font-extrabold text-emerald-600 mt-0.5">${formatMoney(avgBondAmt)}</p>
                        </div>
                    </div>
                </div>

                <div class="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm mb-6 flex flex-col gap-3">
                    <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                        <div class="flex flex-wrap items-center gap-3">
                            <div class="flex items-center gap-2">
                                <span class="text-xs font-bold text-gray-600">직전 마감월</span>
                                <input type="text" id="bondMonthInput" value="${state.bondTargetMonth || ''}" placeholder="YYYYMM" class="w-20 px-2 py-1 border border-gray-200 rounded-lg text-xs font-bold focus:ring-2 focus:ring-primary/20 outline-none text-center">
                                <button id="bondQueryBtn" class="px-2.5 py-1 bg-primary hover:bg-primary/90 text-white text-xs font-bold rounded-lg transition whitespace-nowrap">조회</button>
                            </div>
                            <div class="h-4 w-px bg-gray-200 hidden md:block"></div>
                            <div class="relative w-48">
                                <input type="text" id="bondSearchInput" placeholder="이름 또는 사번 검색" class="w-full pl-8 pr-3 py-1 border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-primary/20">
                                <span class="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-gray-400">
                                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                                </span>
                            </div>
                        </div>
                        <div class="w-full md:w-auto flex justify-end">
                            <button id="bondSaveAllBtn" class="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm transition flex items-center gap-1.5">
                                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path></svg>
                                <span>보유채권 전체저장</span>
                            </button>
                        </div>
                    </div>
                    <div class="flex flex-wrap items-center gap-4 pt-2 border-t border-gray-100">
                        <label class="flex items-center gap-1.5 cursor-pointer text-xs font-bold text-gray-600 select-none">
                            <input type="checkbox" id="bondOnlyNeededInput" ${state.bondOnlyNeeded ? 'checked' : ''} class="w-3.5 h-3.5 rounded text-primary focus:ring-primary/20 border-gray-300">
                            <span>증액 필요자만 보기</span>
                        </label>
                        <label class="flex items-center gap-1.5 cursor-pointer text-xs font-bold text-gray-600 select-none">
                            <input type="checkbox" id="bondExcludeZeroPremiumInput" ${state.bondExcludeZeroPremium ? 'checked' : ''} class="w-3.5 h-3.5 rounded text-primary focus:ring-primary/20 border-gray-300">
                            <span>마감월 보험료(생보+손보) 0인 인원 제외</span>
                        </label>
                        <label class="flex items-center gap-1.5 cursor-pointer text-xs font-bold text-gray-600 select-none">
                            <input type="checkbox" id="bondOnlyZeroBondInput" ${state.bondOnlyZeroBond ? 'checked' : ''} class="w-3.5 h-3.5 rounded text-primary focus:ring-primary/20 border-gray-300">
                            <span>보유채권 0원인 인원만 보기</span>
                        </label>
                    </div>
                </div>

                <div class="hidden lg:block bg-white shadow-sm border border-gray-200 rounded-2xl overflow-hidden mb-6">
                    <div class="overflow-x-auto">
                        <table class="min-w-full divide-y divide-gray-200 whitespace-nowrap text-xs" id="bondTable">
                            <thead class="bg-gray-50 text-[11px] font-bold text-gray-500">
                                <tr>
                                    <th colspan="4" class="px-2 py-2 text-center text-gray-600 border-b border-r border-gray-200 bg-gray-100/50">인적 사항</th>
                                    <th class="px-2 py-2 text-center text-violet-700 bg-violet-50/50 border-b border-r border-gray-200">마감월 수당</th>
                                    <th colspan="4" class="px-2 py-2 text-center text-blue-700 bg-blue-50/50 border-b border-r border-gray-200">총수당 대비 기준액</th>
                                    <th class="px-2 py-2 text-center text-emerald-700 bg-emerald-50/30 border-b border-r border-gray-200">담보 채권</th>
                                    <th colspan="4" class="px-2 py-2 text-center text-rose-700 bg-rose-50/50 border-b border-r border-gray-200">증액 필요 금액</th>
                                    <th colspan="2" class="px-2 py-2 text-center text-amber-700 bg-amber-50/50 border-b">마감월 보험료</th>
                                </tr>
                                <tr class="bg-gray-50/80 border-b border-gray-100">
                                    <th class="px-2 py-2.5 text-center border-r border-gray-100">이름</th>
                                    <th class="px-2 py-2.5 text-center border-r border-gray-100">사번</th>
                                    <th class="px-2 py-2.5 text-center border-r border-gray-100">입사년월</th>
                                    <th class="px-2 py-2.5 text-center border-r border-gray-200">1년경과</th>
                                    <th class="px-2 py-2.5 text-right bg-violet-50/10 border-r border-gray-200" title="(생보 × 900%) + (손보 × 750%)">직전 마감월</th>
                                    <th class="px-2 py-2.5 text-right bg-blue-50/10 border-r border-gray-100" title="직전 3개월 총수당 × 130%">3개월 (130%)</th>
                                    <th class="px-2 py-2.5 text-right bg-blue-50/10 border-r border-gray-100" title="직전 6개월 총수당 × 60%">6개월 (60%)</th>
                                    <th class="px-2 py-2.5 text-right bg-blue-50/10 border-r border-gray-100" title="직전 9개월 총수당 × 40%">9개월 (40%)</th>
                                    <th class="px-2 py-2.5 text-right bg-blue-50/10 border-r border-gray-200" title="직전 12개월 총수당 × 25%">12개월 (25%)</th>
                                    <th class="px-2 py-2.5 text-center bg-emerald-50/15 border-r border-gray-200">보유채권</th>
                                    <th class="px-2 py-2.5 text-right bg-rose-50/10 border-r border-gray-100">3개월</th>
                                    <th class="px-2 py-2.5 text-right bg-rose-50/10 border-r border-gray-100">6개월</th>
                                    <th class="px-2 py-2.5 text-right bg-rose-50/10 border-r border-gray-100">9개월</th>
                                    <th class="px-2 py-2.5 text-right bg-rose-50/10 border-r border-gray-200">12개월</th>
                                    <th class="px-2 py-2.5 text-right bg-amber-50/10 border-r border-gray-100">생보</th>
                                    <th class="px-2 py-2.5 text-right bg-amber-50/10">손보</th>
                                </tr>
                            </thead>
                            <tbody id="bondTableBody" class="divide-y divide-gray-100 bg-white">
                            </tbody>
                        </table>
                    </div>
                    <div id="bondTableEmpty" class="hidden p-12 text-center text-gray-400 font-medium bg-white">검색 결과에 맞는 채권 데이터가 없습니다.</div>
                </div>

                <div id="bondMobileList" class="lg:hidden flex flex-col gap-3 mb-6">
                </div>
            `;

            function formatRawNum(num) {
                return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
            }

            // 직전 마감월 기준액: (생보 × 900%) + (손보 × 750%)
            function calcLastMonth(u) {
                return Math.round((u.lifePremium || 0) * 9 + (u.nonLifePremium || 0) * 7.5);
            }
            // 기준액: 백엔드에서 이미 multiplier 적용됨
            // allowance3m = 3m총수당 × 1.3
            // allowance6m = 6m총수당 × 0.6
            // allowance9m = 9m총수당 × 0.4
            // allowance12m = 12m총수당 × 0.25

            function fmtBlue(val) {
                if (!val || val === 0) return '<span class="text-gray-300">-</span>';
                return `<span class="text-gray-700">${formatMoney(val)}</span>`;
            }
            function fmtNeed(val, isMax) {
                if (val <= 0) return '<span class="text-gray-200">-</span>';
                if (isMax) return `<span class="text-red-500 font-bold">${formatMoney(val)}</span>`;
                return `<span class="text-gray-400">${formatMoney(val)}</span>`;
            }

            function renderBondTable(result) {
                const tbody = div.querySelector('#bondTableBody');
                const emptyDiv = div.querySelector('#bondTableEmpty');
                if (!tbody) return;
                if (result.length === 0) {
                    tbody.innerHTML = '';
                    if (emptyDiv) emptyDiv.classList.remove('hidden');
                    return;
                }
                if (emptyDiv) emptyDiv.classList.add('hidden');

                tbody.innerHTML = result.map(u => {
                    const bond = state.bondUpdates[u.id] !== undefined ? state.bondUpdates[u.id] : u.bond;
                    const lastMonth = calcLastMonth(u);
                    // 3개월 기준액은 보유채권의 130%로 계산
                    const a3m = Math.round(bond * 1.3);
                    const a6m = u.allowance6m;
                    const a9m = u.allowance9m;
                    const a12m = u.allowance12m;

                    // 증액필요금액 계산 (u.allowance3m은 3개월 총수당 원본합)
                    const rn3 = u.allowance3m > a3m ? u.allowance3m - a3m : 0;
                    const rn6 = a6m > bond ? a6m - bond : 0;
                    const rn9 = a9m > bond ? a9m - bond : 0;
                    const rn12 = a12m > bond ? a12m - bond : 0;
                    const maxNeed = Math.max(rn3, rn6, rn9, rn12);

                    return `
                    <tr class="hover:bg-gray-50 transition border-b border-gray-100" data-uid="${u.id}">
                        <td class="px-2 py-2 text-center font-bold text-gray-800 border-r border-gray-100">${u.name}</td>
                        <td class="px-2 py-2 text-center text-gray-500 font-mono border-r border-gray-100">${u.id}</td>
                        <td class="px-2 py-2 text-center text-gray-500 font-mono border-r border-gray-100">${u.joinDate || '-'}</td>
                        <td class="px-2 py-2 text-center font-bold text-gray-700 border-r border-gray-200">${u.isOverOneYear || ''}</td>
                        <td class="px-2 py-2 text-right font-mono bg-violet-50/5 border-r border-gray-200">${fmtBlue(lastMonth)}</td>
                        <td class="px-2 py-2 text-right font-mono bg-blue-50/5 border-r border-gray-100 bond-a3m">${fmtBlue(a3m)}</td>
                        <td class="px-2 py-2 text-right font-mono bg-blue-50/5 border-r border-gray-100">${fmtBlue(a6m)}</td>
                        <td class="px-2 py-2 text-right font-mono bg-blue-50/5 border-r border-gray-100">${fmtBlue(a9m)}</td>
                        <td class="px-2 py-2 text-right font-mono bg-blue-50/5 border-r border-gray-200">${fmtBlue(a12m)}</td>
                        <td class="px-2 py-1.5 text-center bg-emerald-50/5 border-r border-gray-200">
                            <input type="text" data-id="${u.id}" value="${bond === 0 ? '' : formatRawNum(bond)}" placeholder="0" class="bond-input w-24 px-2 py-1 text-right border border-gray-200 rounded focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 outline-none font-bold text-xs">
                        </td>
                        <td class="px-2 py-2 text-right font-mono bg-rose-50/5 border-r border-gray-100 bond-need-3m">${fmtNeed(rn3, maxNeed > 0 && rn3 === maxNeed)}</td>
                        <td class="px-2 py-2 text-right font-mono bg-rose-50/5 border-r border-gray-100 bond-need-6m">${fmtNeed(rn6, maxNeed > 0 && rn6 === maxNeed)}</td>
                        <td class="px-2 py-2 text-right font-mono bg-rose-50/5 border-r border-gray-100 bond-need-9m">${fmtNeed(rn9, maxNeed > 0 && rn9 === maxNeed)}</td>
                        <td class="px-2 py-2 text-right font-mono bg-rose-50/5 border-r border-gray-200 bond-need-12m">${fmtNeed(rn12, maxNeed > 0 && rn12 === maxNeed)}</td>
                        <td class="px-2 py-2 text-right font-mono bg-amber-50/5 border-r border-gray-100">${fmtBlue(u.lifePremium)}</td>
                        <td class="px-2 py-2 text-right font-mono bg-amber-50/5">${fmtBlue(u.nonLifePremium)}</td>
                    </tr>`;
                }).join('');

                tbody.querySelectorAll('.bond-input').forEach(input => {
                    input.addEventListener('input', (e) => {
                        const raw = e.target.value.replace(/[^0-9]/g, '');
                        const val = raw ? parseInt(raw, 10) : 0;
                        const id = e.target.getAttribute('data-id');
                        state.bondUpdates[id] = val;
                        const prevLen = e.target.value.length;
                        const cursorPos = e.target.selectionStart;
                        e.target.value = val === 0 ? '' : formatRawNum(val);
                        const diff = e.target.value.length - prevLen;
                        try { e.target.setSelectionRange(cursorPos + diff, cursorPos + diff); } catch(_) {}

                        const tr = e.target.closest('tr');
                        if (tr) {
                            const u = list.find(user => String(user.id) === String(id));
                            if (u) {
                                const bond2 = val;
                                // 3개년 기준액은 변경된 보유채권의 130%로 업데이트
                                const a3m2 = Math.round(bond2 * 1.3);
                                const rn3b = u.allowance3m > a3m2 ? u.allowance3m - a3m2 : 0;
                                const rn6b = u.allowance6m > bond2 ? u.allowance6m - bond2 : 0;
                                const rn9b = u.allowance9m > bond2 ? u.allowance9m - bond2 : 0;
                                const rn12b = u.allowance12m > bond2 ? u.allowance12m - bond2 : 0;
                                const mx = Math.max(rn3b, rn6b, rn9b, rn12b);

                                tr.querySelector('.bond-a3m').innerHTML = fmtBlue(a3m2);
                                tr.querySelector('.bond-need-3m').innerHTML = fmtNeed(rn3b, mx > 0 && rn3b === mx);
                                tr.querySelector('.bond-need-6m').innerHTML = fmtNeed(rn6b, mx > 0 && rn6b === mx);
                                tr.querySelector('.bond-need-9m').innerHTML = fmtNeed(rn9b, mx > 0 && rn9b === mx);
                                tr.querySelector('.bond-need-12m').innerHTML = fmtNeed(rn12b, mx > 0 && rn12b === mx);
                            }
                        }
                    });
                });
            }

            function renderBondMobile(result) {
                const mobileList = div.querySelector('#bondMobileList');
                if (!mobileList) return;
                if (result.length === 0) {
                    mobileList.innerHTML = '<div class="p-8 text-center text-gray-400 bg-white rounded-2xl">검색 결과에 맞는 채권 데이터가 없습니다.</div>';
                    return;
                }
                mobileList.innerHTML = result.map(u => {
                    const bond = state.bondUpdates[u.id] !== undefined ? state.bondUpdates[u.id] : u.bond;
                    const a3m = Math.round(bond * 1.3);
                    const rn3 = u.allowance3m > a3m ? u.allowance3m - a3m : 0;
                    const rn6 = u.allowance6m > bond ? u.allowance6m - bond : 0;
                    const rn9 = u.allowance9m > bond ? u.allowance9m - bond : 0;
                    const rn12 = u.allowance12m > bond ? u.allowance12m - bond : 0;
                    const maxNeed = Math.max(rn3, rn6, rn9, rn12);
                    const statusText = maxNeed > 0 ? `증액 필요: ${formatMoney(maxNeed)}` : '보유채권 적정';
                    const statusClass = maxNeed > 0 ? 'bg-red-50 text-red-600 border-red-100' : 'bg-green-50 text-green-600 border-green-100';
                    return `
                    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                        <div class="flex justify-between items-start mb-2">
                            <div>
                                <h4 class="font-bold text-gray-900 text-sm">${u.name} <span class="text-xs text-gray-400 font-mono">(${u.id})</span></h4>
                                <p class="text-[10px] text-gray-400 font-mono mt-0.5">입사년월: ${u.joinDate || '-'} | 1년경과: ${u.isOverOneYear || 'X'}</p>
                            </div>
                            <span class="px-2 py-0.5 text-[10px] rounded-lg border font-bold ${statusClass}">${statusText}</span>
                        </div>
                        <div class="grid grid-cols-2 gap-2 text-xs bg-gray-50/50 rounded-xl p-3 mt-3">
                            <div>
                                <p class="text-gray-400 text-[10px] mb-0.5">3개월 기준 (보유채권×130%)</p>
                                <p class="font-semibold text-gray-700 bond-m-a3m">${formatMoney(a3m)}</p>
                            </div>
                            <div>
                                <p class="text-gray-400 text-[10px] mb-0.5">6개월 기준 (총수당×60%)</p>
                                <p class="font-semibold text-gray-700">${formatMoney(u.allowance6m)}</p>
                            </div>
                            <div class="mt-2">
                                <p class="text-gray-400 text-[10px] mb-0.5">9개월 기준 (총수당×40%)</p>
                                <p class="font-semibold text-gray-700">${formatMoney(u.allowance9m)}</p>
                            </div>
                            <div class="mt-2">
                                <p class="text-gray-400 text-[10px] mb-0.5">12개월 기준 (총수당×25%)</p>
                                <p class="font-semibold text-gray-700">${formatMoney(u.allowance12m)}</p>
                            </div>
                            <div class="col-span-2 mt-2 pt-2 border-t border-gray-200/50 flex items-center justify-between">
                                <span class="font-bold text-emerald-700">보유채권</span>
                                <input type="text" data-id="${u.id}" value="${bond === 0 ? '' : formatRawNum(bond)}" placeholder="0" class="bond-input-m w-28 px-2 py-1 text-right border border-gray-200 rounded-lg focus:border-emerald-500 outline-none font-bold text-xs">
                            </div>
                        </div>
                        <div class="mt-2 flex justify-between items-center text-[10px] text-gray-400 px-1">
                            <span>마감월 보험료: 생보 ${formatMoney(u.lifePremium)} | 손보 ${formatMoney(u.nonLifePremium)}</span>
                        </div>
                    </div>`;
                }).join('');

                mobileList.querySelectorAll('.bond-input-m').forEach(input => {
                    input.addEventListener('input', (e) => {
                        const raw = e.target.value.replace(/[^0-9]/g, '');
                        const val = raw ? parseInt(raw, 10) : 0;
                        const id = e.target.getAttribute('data-id');
                        state.bondUpdates[id] = val;
                        const prevLen = e.target.value.length;
                        const cursorPos = e.target.selectionStart;
                        e.target.value = val === 0 ? '' : formatRawNum(val);
                        const diff = e.target.value.length - prevLen;
                        try { e.target.setSelectionRange(cursorPos + diff, cursorPos + diff); } catch(_) {}

                        const card = e.target.closest('.bg-white');
                        if (card) {
                            const u = list.find(user => String(user.id) === String(id));
                            if (u) {
                                const bond2 = val;
                                const a3m2 = Math.round(bond2 * 1.3);
                                const rn3b = u.allowance3m > a3m2 ? u.allowance3m - a3m2 : 0;
                                const rn6b = u.allowance6m > bond2 ? u.allowance6m - bond2 : 0;
                                const rn9b = u.allowance9m > bond2 ? u.allowance9m - bond2 : 0;
                                const rn12b = u.allowance12m > bond2 ? u.allowance12m - bond2 : 0;
                                const mx = Math.max(rn3b, rn6b, rn9b, rn12b);

                                card.querySelector('.bond-m-a3m').innerText = formatMoney(a3m2);
                                
                                const statusEl = card.querySelector('span.px-2.py-0.5');
                                if (statusEl) {
                                    statusEl.innerText = mx > 0 ? `증액 필요: ${formatMoney(mx)}` : '보유채권 적정';
                                    statusEl.className = `px-2 py-0.5 text-[10px] rounded-lg border font-bold ${mx > 0 ? 'bg-red-50 text-red-600 border-red-100' : 'bg-green-50 text-green-600 border-green-100'}`;
                                }
                            }
                        }
                    });
                });
            }

            function applyBondFilters() {
                const searchVal = (div.querySelector('#bondSearchInput')?.value || '').trim().toLowerCase();
                const onlyNeeded = div.querySelector('#bondOnlyNeededInput')?.checked || false;
                const excludeZeroPremium = div.querySelector('#bondExcludeZeroPremiumInput')?.checked || false;
                const onlyZeroBond = div.querySelector('#bondOnlyZeroBondInput')?.checked || false;

                let result = list.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
                if (searchVal) {
                    result = result.filter(u => u.name.toLowerCase().includes(searchVal) || String(u.id).includes(searchVal));
                }
                if (onlyNeeded) {
                    result = result.filter(u => {
                        const bond = state.bondUpdates[u.id] !== undefined ? state.bondUpdates[u.id] : u.bond;
                        const a3m = Math.round(bond * 1.3);
                        const rn3 = u.allowance3m > a3m ? u.allowance3m - a3m : 0;
                        const rn6 = u.allowance6m > bond ? u.allowance6m - bond : 0;
                        const rn9 = u.allowance9m > bond ? u.allowance9m - bond : 0;
                        const rn12 = u.allowance12m > bond ? u.allowance12m - bond : 0;
                        return rn3 > 0 || rn6 > 0 || rn9 > 0 || rn12 > 0;
                    });
                }
                if (excludeZeroPremium) {
                    result = result.filter(u => (u.lifePremium || 0) + (u.nonLifePremium || 0) > 0);
                }
                if (onlyZeroBond) {
                    result = result.filter(u => {
                        const bond = state.bondUpdates[u.id] !== undefined ? state.bondUpdates[u.id] : u.bond;
                        return bond === 0;
                    });
                }
                renderBondTable(result);
                renderBondMobile(result);
            }

            setTimeout(() => {
                const monthInput = div.querySelector('#bondMonthInput');
                const queryBtn = div.querySelector('#bondQueryBtn');
                if (queryBtn && monthInput) {
                    const doQuery = () => {
                        const m = monthInput.value.trim();
                        if (m.length === 6 && !isNaN(m)) {
                            state.bondTargetMonth = m;
                            state.bondData = null;
                            render();
                        } else {
                            alert('올바른 마감월 형식(YYYYMM)을 입력해 주세요.');
                        }
                    };
                    queryBtn.onclick = doQuery;
                    monthInput.onkeydown = (e) => { if (e.key === 'Enter') doQuery(); };
                }

                const searchInput = div.querySelector('#bondSearchInput');
                if (searchInput) {
                    searchInput.value = state.bondSearch || '';
                    searchInput.addEventListener('input', () => {
                        state.bondSearch = searchInput.value;
                        applyBondFilters();
                    });
                }

                const onlyNeededCheck = div.querySelector('#bondOnlyNeededInput');
                if (onlyNeededCheck) {
                    onlyNeededCheck.addEventListener('change', () => {
                        state.bondOnlyNeeded = onlyNeededCheck.checked;
                        applyBondFilters();
                    });
                }
                const excludeZeroCheck = div.querySelector('#bondExcludeZeroPremiumInput');
                if (excludeZeroCheck) {
                    excludeZeroCheck.addEventListener('change', () => {
                        state.bondExcludeZeroPremium = excludeZeroCheck.checked;
                        applyBondFilters();
                    });
                }
                const onlyZeroBondCheck = div.querySelector('#bondOnlyZeroBondInput');
                if (onlyZeroBondCheck) {
                    onlyZeroBondCheck.addEventListener('change', () => {
                        state.bondOnlyZeroBond = onlyZeroBondCheck.checked;
                        applyBondFilters();
                    });
                }

                applyBondFilters();

                const saveAllBtn = div.querySelector('#bondSaveAllBtn');
                if (saveAllBtn) {
                    saveAllBtn.onclick = async () => {
                        const keys = Object.keys(state.bondUpdates || {});
                        if (keys.length === 0) {
                            alert('수정된 보유채권 내역이 없습니다.');
                            return;
                        }
                        if (!confirm(`${keys.length}명의 보유채권 변경사항을 저장하시겠습니까?`)) {
                            return;
                        }
                        saveAllBtn.disabled = true;
                        const originalHtml = saveAllBtn.innerHTML;
                        saveAllBtn.innerHTML = `
                            <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg><span>저장 중...</span>`;
                        try {
                            const res = await callApi('saveBondManagementData', state.user.staffId, state.bondUpdates);
                            if (res.error || !res.success) {
                                alert(res.message || '보유채권 저장 중 오류가 발생했습니다.');
                            } else {
                                alert(res.message || '보유채권이 성공적으로 저장되었습니다.');
                                state.bondData = null;
                                render();
                            }
                        } catch (e) {
                            alert('서버와의 통신에 실패했습니다: ' + e.toString());
                        } finally {
                            saveAllBtn.disabled = false;
                            saveAllBtn.innerHTML = originalHtml;
                        }
                    };
                }
            }, 0);

            return div;
        }

        // --- 8. Logic Interactions ---
        async function doLogin(id, pw) {
            const btn = document.querySelector('#loginForm button[type="submit"]');
            let originalText = "로그인";
            if (btn) {
                originalText = btn.innerHTML;
                btn.disabled = true;
                btn.classList.add('opacity-80', 'cursor-not-allowed');
            }

            // [UX IMPROVEMENT] 전체 화면 "Long-Run Together!" 스플래시 로딩 즉시 표시
            showLoginSplash(true, '인증 및 데이터를 준비하고 있습니다...');

            const r = await callApi('loginUser', id, pw);

            if (btn) {
                btn.innerHTML = originalText;
                btn.disabled = false;
                btn.classList.remove('opacity-80', 'cursor-not-allowed');
            }

            if (r.success) {
                state.user = r.user;
                if (r.months && r.months.length > 0) {
                    state.months = r.months;
                    state.currentMonth = r.currentMonth || r.months[0];
                } else {
                    const now = new Date(); state.months = [String(now.getFullYear()) + String(now.getMonth() + 1).padStart(2, '0')];
                    state.currentMonth = state.months[0];
                }
                
                // [OPTIMIZATION] 로그인 응답의 initialHomeData 즉시 바인딩 (0초 홈 렌더링)
                if (r.initialHomeData && r.initialHomeData.success) {
                    const ihd = r.initialHomeData;
                    if (ihd.homeData) {
                        state.data.homeData = ihd.homeData;
                        state.homeLoaded = true;
                        sessionStorage.setItem(`DATA_${state.user.staffId}_${state.currentMonth}_home`, JSON.stringify(ihd.homeData));
                    }
                    if (ihd.lapseData) {
                        state.lapseData = ihd.lapseData;
                        state.lapseLoaded = true;
                        sessionStorage.setItem(`DATA_${state.user.staffId}_${state.currentMonth}_lapse`, JSON.stringify(ihd.lapseData));
                    }
                    if (ihd.performanceData) {
                        state.performanceData = ihd.performanceData;
                        state.performanceLoaded = true;
                        sessionStorage.setItem(`DATA_${state.user.staffId}_${state.currentMonth}_perf`, JSON.stringify(ihd.performanceData));
                    }
                }

                if (state.user.isFirstLogin) {
                    showLoginSplash(false);
                    openChangePasswordModal(false);
                } else {
                    saveSession();
                    state.prefetchTriggered = false; // Reset trigger flag
                    navigate('home');
                    // 홈 화면이 렌더링된 후 부드럽게 스플래시 페이드 아웃
                    setTimeout(() => {
                        showLoginSplash(false);
                    }, 200);
                }
            } else {
                showLoginSplash(false);
                alert(r.message || '로그인 실패');
            }
        }

        function logout() {
            state.user = null;
            state.homeLoaded = false;
            state.lapseLoaded = false;
            state.prefetchTriggered = false; // Reset trigger flag
            state.lapseData = {};
            state.data = {};
            clearSession();
            navigate('login');
        }

        window.handleHardRefresh = async function() {
            if (!state.user) return;
            
            state.prefetchTriggered = false; // Reset trigger flag
            // 0. 로딩바 시작
            showLoading(true);
            
            try {
                // 1. 구글 서버(백엔드)의 모든 캐시 데이터 일괄 삭제 요청
                await callApi('clearAllCache');
            } catch(e) {
                console.error('Server cache clear failed:', e);
            }
            
            // 2. Session Storage에서 캐시 데이터 삭제 (DATA_ 로 시작하는 키)
            for (let i = sessionStorage.length - 1; i >= 0; i--) {
                const key = sessionStorage.key(i);
                if (key && key.startsWith('DATA_')) {
                    sessionStorage.removeItem(key);
                }
            }
            
            // 3. 메모리 캐시 및 데이터 상태 초기화
            state.homeLoaded = false;
            state.lapseLoaded = false;
            state.performanceLoaded = false;
            state.perfAnalysisLoaded = false;
            state.forecastLoaded = false;
            if (state.activityState) {
                state.activityState.loaded = false;
                state.activityState.data = null;
            }
            
            state.data = {};
            state.lapseData = { lapsed: [], arrears: [], unpaid: [] };
            state.performanceData = null;
            state.perfAnalysisData = null;
            state.forecastConfigs = [];
            state.actualIncentives = {};
            
            state.dashboardSelectedMember = null;
            state.recruitmentSelectedMember = null;
            
            // 4. 로딩바 종료 및 홈 화면으로 이동하며 데이터를 다시 가져옴
            showLoading(false);
            navigate('home');
        };

        function refresh() {
            if (!state.user) return;

            // [OPTIMIZATION] Client-side caching
            const cacheKey = `DATA_${state.user.staffId}_${state.currentMonth}_${state.currentView}`;

            // 1. Check Memory State
            if (state.currentView === 'home' && state.data.homeData && state.lapseLoaded && state.performanceLoaded) {
                render();
                if (state.performanceData) renderPerformanceChart();
                if (!state.prefetchTriggered) {
                    state.prefetchTriggered = true;
                    setTimeout(prefetchAllBackground, 800);
                }
                return;
            }
            if (state.currentView === 'dashboard' && state.dashboardSelectedMember) { render(); return; } // 소속원 선택됨: render()에서 직접 로딩
            if (state.currentView === 'recruitment' && state.recruitmentSelectedMember) { render(); return; } // 증원수당 소속원 선택됨: render()에서 직접 로딩
            if (state.currentView === 'dashboard' && state.data.rewardData?.month === state.currentMonth) { render(); return; }
            if (state.currentView === 'recruitment' && state.data.recData?.month === state.currentMonth) { render(); return; }
            if (state.currentView === 'branch' && state.data.rewardData?.month === state.currentMonth &&
                state.data.branchCommData?.month === state.currentMonth) { render(); return; }
            if (state.currentView === 'performanceAnalysis' && state.perfAnalysisLoaded) { return; }
            if (state.currentView === 'totalAllowanceForecast' && state.forecastLoaded) { return; }

            // 2. Check Session Storage
            const cached = sessionStorage.getItem(cacheKey);
            if (cached) {
                try {
                    const parsed = JSON.parse(cached);
                    // Update State
                    if (state.currentView === 'home') {
                        state.data.homeData = parsed;
                        state.homeLoaded = true;
                    }
                    else if (state.currentView === 'branch') {
                        // branch 뷰: rewardData는 세션 캐시 복원, branchCommData는 별도 fetch
                        state.data.rewardData = parsed;
                        state.isLoading = false;
                        render();
                        if (!state.data.branchCommData || state.data.branchCommData.month !== state.currentMonth) {
                            callApi('getBranchCommissionData', state.user.staffId, state.currentMonth).then(commRes => {
                                if (!commRes.error && commRes.success) {
                                    commRes.month = state.currentMonth;
                                    state.data.branchCommData = commRes;
                                } else {
                                    state.data.branchCommData = { month: state.currentMonth, lifePay: 0, lifeRefund: 0, nonLifePay: 0, nonLifeRefund: 0 };
                                    if (commRes.error) console.warn('수수료 로드 실패:', commRes.message);
                                }
                                if (state.currentView === 'branch') render();
                            });
                        }
                        return;
                    }
                    else if (state.currentView === 'dashboard') state.data.rewardData = parsed;
                    else if (state.currentView === 'recruitment') state.data.recData = parsed;
                    else if (state.currentView === 'admin') state.data.adminSummary = parsed;

                    state.isLoading = false; // [FIX] Reset loading state when using cache
                    render();
                    if (state.currentView === 'home') fetchPerformanceTrend();
                    return; // Skip fetch
                } catch (e) {
                    sessionStorage.removeItem(cacheKey);
                }
            }

            if (state.currentView === 'home') {
                loadHomeDataDirect();
            }
            else if (state.currentView === 'dashboard') fetchReward(cacheKey);
            else if (state.currentView === 'branch') fetchBranch(cacheKey);
            else if (state.currentView === 'recruitment') fetchRec(cacheKey);
            else if (state.currentView === 'admin') fetchAdmin(cacheKey);
            else if (state.currentView === 'performanceAnalysis') fetchPerformanceAnalysisData();
            else if (state.currentView === 'totalAllowanceForecast') fetchTotalAllowanceForecastData();
        }

        async function fetchPerformanceAnalysisData() {
            if (!state.perfAnalysisLoaded) {
                state.isLoading = true;
                render();
            } else {
                // 새 값으로 렌더링을 기다리는 동안 투명도를 낮춰 부드러운 로딩 효과 적용
                const canvases = document.querySelectorAll('canvas');
                canvases.forEach(c => { c.style.transition = 'opacity 0.2s'; c.style.opacity = '0.1'; });
                const topP = document.getElementById('top-partners-container');
                if (topP) { topP.style.transition = 'opacity 0.2s'; topP.style.opacity = '0.1'; }
            }
            state.perfAnalysisOrgFilter = state.perfAnalysisOrgFilter || '전체';
            const res = await callApi('getPerformanceAnalysisData', state.user.staffId, state.perfAnalysisYear, state.perfAnalysisMonth, state.perfAnalysisOrgFilter);
            state.isLoading = false;

            if (res && res.success) {
                state.perfAnalysisData = res;
                state.perfAnalysisLoaded = true;
                // 백엔드가 폴백(fallback)하여 데이터를 불러온 실제 연월 값으로 상태를 동기화
                if (res.year) state.perfAnalysisYear = res.year;
                if (res.month) state.perfAnalysisMonth = res.month;
                render();
                // [NEW] 기준일 업데이트 (render 후 요소가 생성된 후 다시 한번 확실히 확인)
                const refDateEl = document.getElementById('perf-analysis-ref-date');
                if (refDateEl && res.referenceDate) {
                    refDateEl.innerText = `(${res.referenceDate} 마감 기준)`;
                }
                setTimeout(renderPerformanceAnalysisCharts, 100);
            } else {
                alert('실적분석 데이터 로드 실패: ' + (res?.message || '알 수 없는 오류'));
                state.perfAnalysisLoaded = true;
                render();
            }
        }

        function createPerformanceAnalysisView() {
            if (state.isLoading && !state.perfAnalysisLoaded) return getSkeletonUI();
            const div = document.createElement('div');
            state.perfAnalysisOrgFilter = state.perfAnalysisOrgFilter || '전체';

            // 연도/월 값 검증 및 2026년 1월 하한 보정
            if (state.perfAnalysisYear < '2026') {
                state.perfAnalysisYear = '2026';
                state.perfAnalysisMonth = '01';
            } else if (state.perfAnalysisYear === '2026' && state.perfAnalysisMonth !== 'All' && state.perfAnalysisMonth < '01') {
                state.perfAnalysisMonth = '01';
            }

            // 2026년 1월부터 로컬 타임 기준 현재 월까지 월 리스트를 동적으로 생성
            const dynamicMonths = [];
            const now = new Date();
            const currentYear = now.getFullYear();
            const currentMonthNum = now.getMonth() + 1;
            let y = 2026;
            let m = 1;
            while (y < currentYear || (y === currentYear && m <= currentMonthNum)) {
                dynamicMonths.push(String(y) + String(m).padStart(2, '0'));
                m++;
                if (m > 12) {
                    m = 1;
                    y++;
                }
            }

            // 기존 state.months와 병합 후 202601 이상의 고유 월 리스트 생성 및 정렬
            const rawMonths = (state.months || []).concat(dynamicMonths);
            const allowedMonths = [...new Set(rawMonths)].filter(m => m >= '202601').sort();

            const years = [...new Set(allowedMonths.map(m => m.substring(0, 4)))].sort().reverse();
            const yearOptions = years.map(y => `<option value="${y}" ${y === state.perfAnalysisYear ? 'selected' : ''}>${y}년</option>`).join('');
            
            // 선택된 연도에 존재하는 202601 이상의 월만 노출
            const availableMonthsForYear = allowedMonths
                .filter(m => m.startsWith(state.perfAnalysisYear))
                .map(m => m.substring(4, 6));
            const uniqueMonths = [...new Set(availableMonthsForYear)].sort();
            
            const monthOptions = ['All', ...uniqueMonths].map(m =>
                `<option value="${m}" ${m === state.perfAnalysisMonth ? 'selected' : ''}>${m === 'All' ? '전체 월' : parseInt(m) + '월'}</option>`
            ).join('');

            // 소속1 목록 생성 (백엔드 orgList 기준, 가나다순)
            const rawOrgList = (state.perfAnalysisData && state.perfAnalysisData.orgList) || [];
            const orgOptions = ['전체', ...rawOrgList].map(o =>
                `<option value="${o}" ${o === state.perfAnalysisOrgFilter ? 'selected' : ''}>${o}</option>`
            ).join('');

            const refDate = (state.perfAnalysisData && state.perfAnalysisData.referenceDate)
                ? ` (${state.perfAnalysisData.referenceDate} 마감 기준)`
                : '';

            const isBranchRepOrOps = isForecastAllowed(); // 권한1이 '지사대표' 또는 '운영진'인지 확인

            const userOrg1 = state.user?.organization || '';
            const title = (isBranchRepOrOps && state.perfAnalysisOrgFilter && state.perfAnalysisOrgFilter !== '전체')
                ? `${state.perfAnalysisOrgFilter} 실적분석`
                : (userOrg1 ? `${userOrg1} 실적분석` : '파트너스본부 실적분석');

            div.innerHTML = `
                <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                    <div>
                        <h2 class="text-2xl font-bold text-gray-800 tracking-tight">${title} <span id="perf-analysis-ref-date" class="text-sm font-normal text-gray-400 ml-2">${refDate}</span></h2>
                        <p class="text-gray-500 text-sm mt-1">데이터 기반 생/손보 포트폴리오 및 파트너 성과 관리</p>
                    </div>
                    <div class="flex flex-wrap md:flex-nowrap gap-2 items-center w-full md:w-auto">
                        ${isBranchRepOrOps ? `
                        <!-- 소속 필터 드롭박스 (연도 월 선택 박스 왼쪽) -->
                        <div class="relative bg-white p-1.5 rounded-2xl shadow-sm border border-gray-100 flex-grow md:flex-grow-0">
                            <select id="perf-org-select" class="appearance-none w-full md:w-36 bg-gray-50 border-none text-gray-700 font-bold py-2.5 pl-4 pr-10 rounded-xl cursor-pointer focus:ring-2 focus:ring-primary/20 transition text-sm">
                                ${orgOptions}
                            </select>
                            <div class="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                            </div>
                        </div>
                        ` : ''}

                        <!-- 연도 월 선택 박스 -->
                        <div class="flex gap-2 bg-white p-1.5 rounded-2xl shadow-sm border border-gray-100 flex-grow md:flex-grow-0">
                            <div class="relative flex-grow md:flex-grow-0">
                                <select id="perf-year-select" class="appearance-none w-full md:w-32 bg-gray-50 border-none text-gray-700 font-bold py-2.5 pl-10 pr-4 rounded-xl cursor-pointer focus:ring-2 focus:ring-primary/20 transition">
                                    ${yearOptions}
                                </select>
                                <div class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                                </div>
                            </div>
                            <div class="relative flex-grow md:flex-grow-0">
                                <select id="perf-month-select" class="appearance-none w-full md:w-32 bg-gray-50 border-none text-gray-700 font-bold py-2.5 pl-4 pr-10 rounded-xl cursor-pointer focus:ring-2 focus:ring-primary/20 transition text-center">
                                    ${monthOptions}
                                </select>
                                <div class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6 mb-8">
                    <!-- 1. 보험사별 실적 분석 -->
                    <div class="lg:col-span-2 bg-white rounded-3xl shadow-sm border border-gray-100 p-5 md:p-8">
                        <div class="flex justify-between items-center mb-8">
                            <div class="flex items-center gap-3">
                                <div class="p-2 bg-orange-50 rounded-xl text-primary">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"></path></svg>
                                </div>
                                <h3 class="text-lg font-bold text-gray-800">${state.perfAnalysisYear}년 ${state.perfAnalysisMonth === 'All' ? '전체' : parseInt(state.perfAnalysisMonth) + '월'} 보험사별 실적 (장기보험료)</h3>
                            </div>
                            <div class="relative w-32 md:w-36">
                                <select id="company-type-select" class="appearance-none w-full bg-gray-50 border-none text-gray-700 font-bold py-2 pl-4 pr-8 rounded-xl cursor-pointer focus:ring-2 focus:ring-primary/20 transition text-sm">
                                    <option value="all">전체 보험사</option>
                                    <option value="nonlife">손해보험사</option>
                                    <option value="life">생명보험사</option>
                                </select>
                                <div class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                                </div>
                            </div>
                        </div>
                        <div class="relative h-[400px]">
                            <canvas id="companyPerfChart"></canvas>
                        </div>
                    </div>

                    <!-- 2. 손보/생보 실적 비율 -->
                    <div class="bg-white rounded-3xl shadow-sm border border-gray-100 p-8 flex flex-col">
                        <div class="flex items-center gap-3 mb-8">
                            <div class="p-2 bg-blue-50 rounded-xl text-blue-600">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"></path></svg>
                            </div>
                            <h3 class="text-lg font-bold text-gray-800">손보/생보 실적 비율</h3>
                        </div>
                        <div class="relative flex-grow flex items-center justify-center">
                            <div class="w-full max-w-[280px]">
                                <canvas id="typeRatioChart"></canvas>
                            </div>
                        </div>
                        <div id="ratio-legend" class="mt-6 flex justify-center gap-8"></div>
                    </div>
                </div>

                <!-- 3. 월별 환산실적 추이 -->
                <div class="bg-white rounded-3xl shadow-sm border border-gray-100 p-5 md:p-8 mb-8">
                    <div class="flex items-center gap-3 mb-8">
                        <div class="p-2 bg-indigo-50 rounded-xl text-indigo-600">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path></svg>
                        </div>
                        <h3 class="text-lg font-bold text-gray-800">${state.perfAnalysisYear}년 월별 환산실적 추이</h3>
                    </div>
                    <div class="relative h-[300px]">
                        <canvas id="monthlyTrendChart"></canvas>
                    </div>
                    <div class="mt-6 flex justify-center gap-6">
                        <div class="flex items-center gap-2">
                             <span class="w-3 h-3 rounded-full bg-blue-500"></span>
                             <span class="text-xs text-gray-500 font-medium">월별 합산실적 (생보+손보)</span>
                        </div>
                        <div class="flex items-center gap-2">
                             <span class="w-3 h-3 rounded-full bg-orange-500"></span>
                             <span class="text-xs text-gray-500 font-medium">분기 누적실적</span>
                        </div>
                    </div>
                </div>

                <!-- 4. 보험사별 우수 파트너 -->
                <div class="bg-white rounded-3xl shadow-sm border border-gray-100 p-5 md:p-8">
                    <div class="flex items-center gap-3 mb-8">
                        <div class="p-2 bg-yellow-50 rounded-xl text-yellow-600">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"></path></svg>
                        </div>
                        <h3 class="text-lg font-bold text-gray-800">보험사별 우수 파트너 (보험료/건수 1위)</h3>
                    </div>
                    
                    <div id="top-partners-container" class="space-y-12"></div>
                </div>
            `;

            setTimeout(() => {
                const orgSelect = div.querySelector('#perf-org-select');
                if (orgSelect) {
                    orgSelect.onchange = (e) => {
                        state.perfAnalysisOrgFilter = e.target.value;
                        fetchPerformanceAnalysisData();
                    };
                }
                div.querySelector('#perf-year-select').onchange = (e) => {
                    state.perfAnalysisYear = e.target.value;
                    fetchPerformanceAnalysisData();
                };
                div.querySelector('#perf-month-select').onchange = (e) => {
                    state.perfAnalysisMonth = e.target.value;
                    fetchPerformanceAnalysisData();
                };
                const companyTypeSelect = div.querySelector('#company-type-select');
                if (companyTypeSelect) {
                    if (state.perfCompanyType) companyTypeSelect.value = state.perfCompanyType;
                    companyTypeSelect.onchange = (e) => {
                        state.perfCompanyType = e.target.value;
                        renderPerformanceAnalysisCharts();
                    };
                }
                if (state.perfAnalysisLoaded) {
                    renderPerformanceAnalysisCharts();
                    renderTopPartners();
                }
            }, 0);

            return div;
        }

        let perfCharts = { bar: null, pie: null, trend: null };

        function renderPerformanceAnalysisCharts() {
            const d = state.perfAnalysisData;
            if (!d) return;

            // (1) Bar Chart
            const barCtx = document.getElementById('companyPerfChart');
            if (barCtx) {
                if (perfCharts.bar) perfCharts.bar.destroy();
                const filterType = state.perfCompanyType || 'all';
                let barDataFiltered = d.barData;
                if (filterType === 'nonlife') barDataFiltered = d.barData.filter(x => x.isNonLife);
                if (filterType === 'life') barDataFiltered = d.barData.filter(x => !x.isNonLife);
                const labels = barDataFiltered.map(x => x.company);
                const values = barDataFiltered.map(x => Math.round(x.premium / 10000));
                const colors = barDataFiltered.map(x => x.isNonLife ? '#F37321' : '#3B82F6');

                perfCharts.bar = new Chart(barCtx, {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [{
                            data: values,
                            backgroundColor: colors,
                            borderRadius: 8,
                            barThickness: 24,
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        layout: {
                            padding: { top: 25 } // 막대 위 텍스트가 잘리지 않도록 상단 여백 추가
                        },
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                callbacks: {
                                    label: (ctx) => `보험료: ${ctx.parsed.y.toLocaleString()}만원`
                                }
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                grid: { color: '#f8fafc' },
                                ticks: { callback: (v) => v.toLocaleString() + '만' },
                                grace: '5%' // 상단 여유 공간 확보
                            },
                            x: { grid: { display: false }, ticks: { font: { size: 10 } } }
                        }
                    },
                    plugins: [{
                        afterDraw: (chart) => {
                            const ctx = chart.ctx;
                            chart.data.datasets.forEach((dataset, i) => {
                                const meta = chart.getDatasetMeta(i);
                                meta.data.forEach((bar, index) => {
                                    const data = dataset.data[index];
                                    if (data > 0) {
                                        ctx.fillStyle = '#64748b';
                                        ctx.font = 'bold 9px Pretendard';
                                        ctx.textAlign = 'center';
                                        ctx.fillText(data.toLocaleString() + '만', bar.x, bar.y - 8);
                                    }
                                });
                            });
                        }
                    }]
                });
            }

            // (2) Pie Chart
            const pieCtx = document.getElementById('typeRatioChart');
            if (pieCtx) {
                if (perfCharts.pie) perfCharts.pie.destroy();
                const total = d.pieData.life + d.pieData.nonLife;
                const lifePct = total > 0 ? (d.pieData.life / total * 100).toFixed(1) : 0;
                const nlPct = total > 0 ? (d.pieData.nonLife / total * 100).toFixed(1) : 0;

                perfCharts.pie = new Chart(pieCtx, {
                    type: 'doughnut',
                    data: {
                        labels: ['생명보험', '손해보험'],
                        datasets: [{
                            data: [d.pieData.life, d.pieData.nonLife],
                            backgroundColor: ['#3B82F6', '#F37321'],
                            borderWidth: 0,
                            cutout: '60%'
                        }]
                    },
                    options: {
                        responsive: true,
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                callbacks: {
                                    label: (ctx) => `${ctx.label}: ${Math.round(ctx.parsed / 10000).toLocaleString()}만원 (${ctx.label === '생명보험' ? lifePct : nlPct}%)`
                                }
                            }
                        }
                    },
                    plugins: [{
                        afterDraw: (chart) => {
                            const { ctx, chartArea: { top, bottom, left, right, width, height } } = chart;
                            chart.data.datasets.forEach((dataset, i) => {
                                chart.getDatasetMeta(i).data.forEach((datapoint, index) => {
                                    const { x, y } = datapoint.tooltipPosition();
                                    const percent = index === 1 ? nlPct : lifePct;
                                    if (percent > 0) {
                                        ctx.fillStyle = '#fff';
                                        ctx.shadowColor = 'rgba(0,0,0,0.3)';
                                        ctx.shadowBlur = 4;
                                        ctx.font = 'bold 12px Pretendard';
                                        ctx.textAlign = 'center';
                                        ctx.fillText(percent + '%', x, y);
                                        ctx.shadowBlur = 0;
                                    }
                                });
                            });

                            // [NEW] 가운데 총 보험료 텍스트
                            const centerX = (left + right) / 2;
                            const centerY = (top + bottom) / 2;
                            ctx.fillStyle = '#64748b'; // text-gray-500
                            ctx.font = '500 12px Pretendard';
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'middle';
                            ctx.fillText('총 보험료', centerX, centerY - 10);

                            ctx.fillStyle = '#1e293b'; // text-gray-800
                            ctx.font = '900 18px Pretendard';
                            const totalVal = Math.round(total / 10000).toLocaleString() + '만';
                            ctx.fillText(totalVal, centerX, centerY + 10);
                        }
                    }]
                });

                document.getElementById('ratio-legend').innerHTML = `
                    <div class="text-center">
                        <p class="text-xs text-orange-500 font-bold mb-1">손해보험</p>
                        <p class="text-lg font-extrabold text-orange-600">${Math.round(d.pieData.nonLife / 10000).toLocaleString()}만</p>
                    </div>
                    <div class="text-center">
                        <p class="text-xs text-blue-500 font-bold mb-1">생명보험</p>
                        <p class="text-lg font-extrabold text-blue-600">${Math.round(d.pieData.life / 10000).toLocaleString()}만</p>
                    </div>
                `;
            }

            // (3) Monthly Trend Chart
            const trendCtx = document.getElementById('monthlyTrendChart');
            if (trendCtx) {
                if (perfCharts.trend) perfCharts.trend.destroy();
                const labels = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

                const now = new Date();
                const currentYear = now.getFullYear().toString();
                const currentMonthIdx = now.getMonth(); // 0-11
                const isCurrentYear = d.year === currentYear;

                const monthlyValues = d.trendData.map((v, i) => {
                    if (isCurrentYear && i > currentMonthIdx) return null;
                    return Math.round(v / 10000);
                });

                // 분기 누적 데이터 계산 (3, 6, 9, 12월)
                const quarterValues = new Array(12).fill(null);
                [2, 5, 8, 11].forEach(idx => {
                    if (isCurrentYear && idx > currentMonthIdx) return;
                    const slice = monthlyValues.slice(idx - 2, idx + 1);
                    if (slice.every(v => v !== null)) {
                        quarterValues[idx] = slice.reduce((a, b) => a + b, 0);
                    }
                });

                perfCharts.trend = new Chart(trendCtx, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [
                            {
                                label: '월별 합산실적',
                                data: monthlyValues,
                                borderColor: '#3B82F6',
                                backgroundColor: 'rgba(59, 130, 246, 0.05)',
                                borderWidth: 3,
                                pointBackgroundColor: '#fff',
                                pointBorderColor: '#3B82F6',
                                pointBorderWidth: 2,
                                pointRadius: 4,
                                tension: 0.3,
                                fill: true
                            },
                            {
                                label: '분기 누적실적',
                                data: quarterValues,
                                borderColor: '#F37321',
                                borderDash: [5, 5],
                                pointStyle: 'circle',
                                pointRadius: 6,
                                pointHoverRadius: 8,
                                pointBackgroundColor: '#fff',
                                pointBorderWidth: 3,
                                showLine: true,
                                spanGaps: true,
                                tension: 0
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        layout: {
                            padding: { top: 35 } // 텍스트가 위에서 잘리지 않도록 충분한 여백 확보
                        },
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                mode: 'index',
                                intersect: false,
                                callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString()}만원` }
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                grid: { color: '#f8fafc' },
                                ticks: { callback: (v) => v.toLocaleString() + '만' },
                                grace: '10%' // 데이터 최대치 위에 공간 확보
                            },
                            x: {
                                grid: { display: false },
                                offset: true
                            }
                        }
                    },
                    plugins: [{
                        afterDraw: (chart) => {
                            const ctx = chart.ctx;
                            chart.data.datasets.forEach((dataset, i) => {
                                const meta = chart.getDatasetMeta(i);
                                meta.data.forEach((point, index) => {
                                    const data = dataset.data[index];
                                    if (data !== null && data > 0) {
                                        ctx.fillStyle = i === 1 ? '#F37321' : '#3B82F6';
                                        ctx.font = 'bold 10px Pretendard';
                                        ctx.textAlign = 'center';
                                        if (i === 1) {
                                            const quarterLabel = '[' + (Math.floor(index / 3) + 1) + '분기]';
                                            ctx.fillText(quarterLabel, point.x, point.y - 25);
                                            ctx.fillText(data.toLocaleString() + '만', point.x, point.y - 12);
                                        } else {
                                            ctx.fillText(data.toLocaleString() + '만', point.x, point.y - 12);
                                        }
                                    }
                                });
                            });
                        }
                    }]
                });
            }
        }

        function renderTopPartners() {
            const container = document.getElementById('top-partners-container');
            if (!container) return;
            const d = state.perfAnalysisData;
            if (!d) return;

            const NL_COMPANIES = ['AIG손보', 'DB손보', 'KB손보', 'NH농협손보', '롯데손보', '메리츠화재', '삼성화재', '하나손보', '한화손보', '현대해상', '흥국화재'];

            const renderGroup = (title, list, color, isNL) => {
                if (list.length === 0) return '';
                const cards = list.map(comp => {
                    const stats = d.topPartners[comp] || { countTop: { name: '-', value: 0, premium: 0 }, premiumTop: { name: '-', value: 0, count: 0 } };
                    const bgClass = isNL ? 'bg-orange-50/50 border-orange-100' : 'bg-blue-50/50 border-blue-100';
                    const currentPremium = d.barData.find(x => x.company === comp)?.premium || 0;
                    return `
                        <div class="${bgClass} rounded-3xl p-4 md:p-6 border hover:shadow-md transition">
                            <h4 class="font-bold text-gray-800 mb-4 ml-1">${comp} <span class="text-sm font-medium text-gray-500 ml-1">(${Math.round(currentPremium / 10000).toLocaleString()}만원)</span></h4>
                            <div class="space-y-3">
                                <div class="bg-white p-4 rounded-2xl flex items-center justify-between border border-gray-50">
                                    <div class="flex items-center gap-3">
                                        <div class="bg-indigo-50 text-indigo-600 text-[10px] font-bold w-20 py-1.5 rounded-lg text-center">보험료 1위</div>
                                        <span class="font-bold text-gray-700">${stats.premiumTop.name}</span>
                                    </div>
                                    <div class="text-right flex items-center">
                                        <span class="text-sm font-bold text-gray-800">${Math.round(stats.premiumTop.value / 10000).toLocaleString()}</span><span class="text-xs text-gray-400 ml-0.5 mr-1.5">만원</span>
                                        <span class="text-xs font-semibold text-gray-500">(${stats.premiumTop.count || 0}건)</span>
                                    </div>
                                </div>
                                <div class="bg-white p-4 rounded-2xl flex items-center justify-between border border-gray-50">
                                    <div class="flex items-center gap-3">
                                        <div class="bg-green-50 text-green-600 text-[10px] font-bold w-20 py-1.5 rounded-lg text-center">건수 1위</div>
                                        <span class="font-bold text-gray-700">${stats.countTop.name}</span>
                                    </div>
                                    <div class="text-right flex items-center">
                                        <span class="text-sm font-bold text-gray-800">${stats.countTop.value}</span><span class="text-xs text-gray-400 ml-0.5 mr-1.5">건</span>
                                        <span class="text-xs font-semibold text-gray-500">(${Math.round((stats.countTop.premium || 0) / 10000).toLocaleString()}만원)</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');

                return `
                    <div class="mb-10">
                        <h4 class="flex items-center gap-2 text-base font-extrabold text-gray-800 uppercase tracking-tight mb-6 px-1">
                            <span class="w-3 h-3 rounded-full" style="background-color: ${color}"></span>
                            ${title} <span class="text-xs font-medium text-gray-400 ml-1">(보험료 실적순)</span>
                        </h4>
                        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            ${cards}
                        </div>
                    </div>
                `;
            };

            const allComps = Object.keys(d.topPartners).sort((a, b) => {
                const premiumA = d.barData.find(x => x.company === a)?.premium || 0;
                const premiumB = d.barData.find(x => x.company === b)?.premium || 0;
                return premiumB - premiumA;
            });

            const nlComps = allComps.filter(c => NL_COMPANIES.some(nc => c.includes(nc)));
            const lifeComps = allComps.filter(c => !NL_COMPANIES.some(nc => c.includes(nc)));

            container.innerHTML =
                renderGroup('손해보험', nlComps, '#F37321', true) +
                renderGroup('생명보험', lifeComps, '#3B82F6', false);
        }

        // ==========================================
        // 총수당 예상 시뮬레이션 관련 프론트엔드 로직
        // ==========================================

        async function fetchTotalAllowanceForecastData() {
            if (!state.forecastLoaded) {
                state.isLoading = true;
                render();
            }
            const res = await callApi('getTotalAllowanceForecastData', state.user.staffId);
            state.isLoading = false;

            if (res && res.success) {
                state.forecastConfigs = res.savedConfigs || [];
                state.actualIncentives = res.actualIncentives || {};
                state.forecastLoaded = true;
                render();
                setTimeout(renderTotalAllowanceForecastChart, 100);
            } else {
                alert('총수당 예상 데이터 로드 실패: ' + (res?.message || '알 수 없는 오류'));
                state.forecastLoaded = true;
                render();
            }
        }

        async function saveTotalAllowanceForecastData(month, data) {
            state.isLoading = true;
            render();
            const res = await callApi('saveTotalAllowanceForecastData', state.user.staffId, month, data);
            state.isLoading = false;

            if (res && res.success) {
                const idx = state.forecastConfigs.findIndex(x => x.month === month);
                if (idx !== -1) {
                    state.forecastConfigs[idx] = { month, ...data };
                } else {
                    state.forecastConfigs.push({ month, ...data });
                }
                alert(month.substring(0, 4) + '년 ' + parseInt(month.substring(4, 6)) + '월 실적 시뮬레이션 설정이 저장되었습니다.');
                render();
                setTimeout(renderTotalAllowanceForecastChart, 100);
            } else {
                alert('저장 실패: ' + (res?.message || '알 수 없는 오류'));
                render();
            }
        }

        async function saveTotalAllowanceForecastDataBatch(year, configsList) {
            state.isLoading = true;
            render();
            const res = await callApi('saveTotalAllowanceForecastDataBatch', state.user.staffId, year, configsList);
            state.isLoading = false;

            if (res && res.success) {
                configsList.forEach(c => {
                    const idx = state.forecastConfigs.findIndex(x => x.month === c.month);
                    if (idx !== -1) {
                        state.forecastConfigs[idx] = c;
                    } else {
                        state.forecastConfigs.push(c);
                    }
                });
                alert(year + '년 시뮬레이션 설정이 일괄 저장되었습니다.');
                render();
                setTimeout(renderTotalAllowanceForecastChart, 100);
            } else {
                alert('일괄 저장 실패: ' + (res?.message || '알 수 없는 오류'));
                render();
            }
        }

        function getForecastDefaultValues(targetMonth) {
            const now = new Date();
            const currentYm = String(now.getFullYear()) + String(now.getMonth() + 1).padStart(2, '0');
            const isFuture = targetMonth > currentYm;

            return {
                nonLifePremium: isFuture ? 0 : 15000000,
                lifePremium: isFuture ? 0 : 5000000,
                nonLifeComm: 30,
                lifeComm: 30,
                nonLifeAward: 80,
                lifeAward: 70
            };
        }

        function get14MonthsAgoYm(targetYm) {
            let year = parseInt(targetYm.substring(0, 4));
            let month = parseInt(targetYm.substring(4, 6));
            month -= 14;
            while (month <= 0) {
                month += 12;
                year -= 1;
            }
            return String(year) + String(month).padStart(2, '0');
        }

        // 월보험료 실시간 천 단위 구분 쉼표(,) 렌더링 헬퍼 함수
        window.formatPremiumInputRealtime = function(inputEl, month, type) {
            let cursorPosition = inputEl.selectionStart;
            const originalLength = inputEl.value.length;

            // 숫자 이외의 문자 제거
            let rawValue = inputEl.value.replace(/[^0-9]/g, '');
            
            if (rawValue === '') {
                inputEl.value = '0';
                handleForecastPremiumChange(month, type, '0');
                return;
            }

            const numValue = Number(rawValue);
            const formatted = numValue.toLocaleString();
            inputEl.value = formatted;

            // 커서 위치 재조정 (쉼표 추가/제거로 인한 길이 차이 보정)
            const newLength = formatted.length;
            cursorPosition = cursorPosition + (newLength - originalLength);
            inputEl.setSelectionRange(cursorPosition, cursorPosition);

            // 계산 연동
            handleForecastPremiumChange(month, type, formatted);
        };

        function createTotalAllowanceForecastView() {
            if (state.isLoading && !state.forecastLoaded) return getSkeletonUI();
            const div = document.createElement('div');

            const selectedYear = state.forecastSelectedYear || '2026';
            const years = ['2026', '2027', '2028', '2029', '2030']; // 시뮬레이션 지원 연도

            // 가로 연도 필터 탭 생성
            const yearTabs = years.map(y => {
                const isActive = y === selectedYear;
                return `
                    <button onclick="state.forecastSelectedYear='${y}'; state.forecastStartMonth=null; render(); setTimeout(renderTotalAllowanceForecastChart, 100);" 
                        class="px-5 py-2.5 rounded-xl font-bold text-sm transition-all duration-200 ${isActive ? 'bg-primary text-white shadow-lg shadow-primary/20 scale-105' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-100'}">
                        ${y}년 실적 시뮬레이션
                    </button>
                `;
            }).join('');

            // 테이블 내 12개월 행 생성
            let rowsHtml = '';
            for (let m = 1; m <= 12; m++) {
                const monthStr = String(m).padStart(2, '0');
                const targetYm = selectedYear + monthStr;

                // 해당 월 데이터 확인
                const saved = state.forecastConfigs.find(x => x.month === targetYm);
                const defaults = getForecastDefaultValues(targetYm);
                const data = saved || defaults;

                // 2차년인센티브(7번): 15차월 지급월 기준으로 표시 (14개월 전 실적에 기인)
                const incentive = state.actualIncentives[get14MonthsAgoYm(targetYm)] || 0;
                
                // 각 항목 금액(원) 계산
                const nlCommAmt = Math.round(data.nonLifePremium * (data.nonLifeComm / 100));
                const lCommAmt = Math.round(data.lifePremium * (data.lifeComm / 100));
                const nlAwardAmt = Math.round(data.nonLifePremium * (data.nonLifeAward / 100));
                const lAwardAmt = Math.round(data.lifePremium * (data.lifeAward / 100));

                // 총수당 = 3번 + 4번 + 5번 + 6번 + 7번
                const totalForecast = nlCommAmt + lCommAmt + nlAwardAmt + lAwardAmt + incentive;

                // 행 클릭 활성화 및 하이라이트 여부 결정 (현재 연월 또는 해당 연도 1월이 디폴트 선택되도록 설정)
                const now = new Date();
                const currentYm = String(now.getFullYear()) + String(now.getMonth() + 1).padStart(2, '0');
                let defaultStartMonth = selectedYear + '01';
                if (currentYm.substring(0, 4) === selectedYear) {
                    defaultStartMonth = currentYm;
                }
                const isSelected = targetYm === (state.forecastStartMonth || defaultStartMonth);
                const activeRowClass = isSelected ? 'bg-indigo-50/70 hover:bg-indigo-100 border-l-4 border-l-indigo-600 font-bold' : '';

                // 15회차 발생분: 해당 월 실적에 따라 미래(14개월 뒤)에 발생하여 지급받을 인센티브
                const occurredIncentive = state.actualIncentives[targetYm] || 0;

                rowsHtml += `
                    <tr onclick="selectForecastMonth('${targetYm}', event)" 
                        class="hover:bg-slate-50 border-b border-gray-100 transition duration-150 cursor-pointer ${activeRowClass}">
                        <td class="px-2 py-1.5 text-center font-extrabold text-gray-800 text-xs">${m}월</td>
                        <!-- 1. 손보 신계약 월보험료 (너비 85px 고정) -->
                        <td class="px-1 py-1.5 text-right">
                            <input type="text" id="nlPrem-${targetYm}" value="${data.nonLifePremium.toLocaleString()}" 
                                oninput="formatPremiumInputRealtime(this, '${targetYm}', 'nonlife')" 
                                class="py-1 px-1.5 text-right border-gray-200 rounded-lg text-xs font-bold focus:border-primary focus:ring-1 focus:ring-primary/20 bg-white" style="width: 85px;" />
                        </td>
                        <!-- 2. 생보 신계약 월보험료 (너비 85px 고정) -->
                        <td class="px-1 py-1.5 text-right">
                            <input type="text" id="lPrem-${targetYm}" value="${data.lifePremium.toLocaleString()}" 
                                oninput="formatPremiumInputRealtime(this, '${targetYm}', 'life')" 
                                class="py-1 px-1.5 text-right border-gray-200 rounded-lg text-xs font-bold focus:border-primary focus:ring-1 focus:ring-primary/20 bg-white" style="width: 85px;" />
                        </td>
                        <!-- 3. 손보 익월수수료율 -->
                        <td class="px-1 py-1.5">
                            <div class="flex flex-col">
                                <div class="flex items-center justify-end gap-1">
                                    <input type="number" id="nlComm-${targetYm}" value="${data.nonLifeComm}" 
                                        oninput="handleForecastRatioChange('${targetYm}', 'nonlife', 'comm')" 
                                        class="w-12 py-1 px-1.5 text-right border-gray-200 rounded-lg text-xs font-bold focus:border-primary focus:ring-1 focus:ring-primary/20 bg-white" />
                                    <span class="text-xs font-bold text-gray-400">%</span>
                                </div>
                                <span id="nlCommAmt-${targetYm}" class="text-[9px] text-gray-400 block text-right mt-0.5 font-medium">${nlCommAmt.toLocaleString()}원</span>
                            </div>
                        </td>
                        <!-- 4. 생보 익월수수료율 -->
                        <td class="px-1 py-1.5">
                            <div class="flex flex-col">
                                <div class="flex items-center justify-end gap-1">
                                    <input type="number" id="lComm-${targetYm}" value="${data.lifeComm}" 
                                        oninput="handleForecastRatioChange('${targetYm}', 'life', 'comm')" 
                                        class="w-12 py-1 px-1.5 text-right border-gray-200 rounded-lg text-xs font-bold focus:border-primary focus:ring-1 focus:ring-primary/20 bg-white" />
                                    <span class="text-xs font-bold text-gray-400">%</span>
                                </div>
                                <span id="lCommAmt-${targetYm}" class="text-[9px] text-gray-400 block text-right mt-0.5 font-medium">${lCommAmt.toLocaleString()}원</span>
                            </div>
                        </td>
                        <!-- 5. 손보 법인시상률 -->
                        <td class="px-1 py-1.5">
                            <div class="flex flex-col">
                                <div class="flex items-center justify-end gap-1">
                                    <input type="number" id="nlAward-${targetYm}" value="${data.nonLifeAward}" 
                                        oninput="handleForecastRatioChange('${targetYm}', 'nonlife', 'award')" 
                                        class="w-12 py-1 px-1.5 text-right border-gray-200 rounded-lg text-xs font-bold focus:border-primary focus:ring-1 focus:ring-primary/20 bg-white" />
                                    <span class="text-xs font-bold text-gray-400">%</span>
                                </div>
                                <span id="nlAwardAmt-${targetYm}" class="text-[9px] text-gray-400 block text-right mt-0.5 font-medium">${nlAwardAmt.toLocaleString()}원</span>
                            </div>
                        </td>
                        <!-- 6. 생보 법인시상률 -->
                        <td class="px-1 py-1.5">
                            <div class="flex flex-col">
                                <div class="flex items-center justify-end gap-1">
                                    <input type="number" id="lAward-${targetYm}" value="${data.lifeAward}" 
                                        oninput="handleForecastRatioChange('${targetYm}', 'life', 'award')" 
                                        class="w-12 py-1 px-1.5 text-right border-gray-200 rounded-lg text-xs font-bold focus:border-primary focus:ring-1 focus:ring-primary/20 bg-white" />
                                    <span class="text-xs font-bold text-gray-400">%</span>
                                </div>
                                <span id="lAwardAmt-${targetYm}" class="text-[9px] text-gray-400 block text-right mt-0.5 font-medium">${lAwardAmt.toLocaleString()}원</span>
                            </div>
                        </td>
                        <!-- 7. 2차년인센티브 (자동조회, 지급월 기준) -->
                        <td class="px-2 py-1.5 text-right text-[11px] font-extrabold text-slate-500 bg-slate-50/50">${incentive.toLocaleString()}원</td>
                        <!-- 총수당 (예상합계) -->
                        <td class="px-2 py-1.5 text-right text-[11px] font-black text-indigo-600 bg-indigo-50/20" id="total-${targetYm}">${totalForecast.toLocaleString()}원</td>
                        <!-- 15회차 발생분 (연한 글씨) -->
                        <td class="px-2 py-1.5 text-right text-[11px] font-medium text-slate-400/80 bg-slate-50/30">${occurredIncentive.toLocaleString()}원</td>
                    </tr>
                `;
            }

            const now = new Date();
            const currentYm = String(now.getFullYear()) + String(now.getMonth() + 1).padStart(2, '0');
            let defaultStartMonth = selectedYear + '01';
            if (currentYm.substring(0, 4) === selectedYear) {
                defaultStartMonth = currentYm;
            }
            const finalStartMonth = state.forecastStartMonth || defaultStartMonth;
            const currentStartLabel = `${finalStartMonth.substring(0, 4)}년 ${parseInt(finalStartMonth.substring(4, 6))}월`;

            div.innerHTML = `
                <div class="mb-8">
                    <h2 class="text-2xl font-bold text-gray-800 tracking-tight">지사대표 총수당예상 시뮬레이션</h2>
                    <p class="text-gray-500 text-sm mt-1">예상 실적 및 수수료/시상 비율을 편집하고 지급월 기준 총수당(2차년 인센티브 포함) 예측 그래프를 확인합니다.</p>
                </div>

                <!-- 연도 필터 탭 -->
                <div class="flex flex-wrap gap-2 mb-6">
                    ${yearTabs}
                </div>

                <div class="grid grid-cols-1 xl:grid-cols-5 gap-8">
                    <!-- 좌측: 입력 그리드 -->
                    <div class="xl:col-span-3 bg-white rounded-3xl p-5 border border-gray-100 shadow-sm flex flex-col overflow-x-auto">
                        <div class="flex items-center justify-between mb-3">
                            <div class="flex items-center gap-2">
                                <h3 class="font-extrabold text-gray-800 text-sm flex items-center gap-2">
                                    <svg class="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                                    월별 시뮬레이션 예상치 입력
                                </h3>
                                <span class="text-[9px] font-semibold text-slate-400">※ 표의 월 행을 클릭하면 해당 월 기준 16개월 그래프로 X축이 자동 전환됩니다.</span>
                            </div>
                            <button onclick="handleBatchSaveTotalAllowanceForecast()" 
                                class="px-3 py-1.5 bg-primary text-white text-[11px] font-extrabold rounded-lg shadow-md shadow-primary/10 hover:bg-primary-dark active:scale-95 transition-all duration-150 flex items-center gap-1.5">
                                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path></svg>
                                전체 저장
                            </button>
                        </div>
                        <div class="overflow-x-auto">
                            <table class="w-full text-left border-collapse min-w-[900px]">
                                <thead>
                                    <tr class="bg-gray-50 text-gray-600 text-[10px] font-extrabold uppercase border-b border-gray-100">
                                        <th class="px-2 py-2 text-center w-12">실적월</th>
                                        <th class="px-1 py-2 text-right">손보 월보험료</th>
                                        <th class="px-1 py-2 text-right">생보 월보험료</th>
                                        <th class="px-1 py-2 text-right">손보 수수료율</th>
                                        <th class="px-1 py-2 text-right">생보 수수료율</th>
                                        <th class="px-1 py-2 text-right">손보 법인시상</th>
                                        <th class="px-1 py-2 text-right">생보 법인시상</th>
                                        <th class="px-2 py-2 text-right">2차년 인센티브</th>
                                        <th class="px-2 py-2 text-right bg-indigo-50/50 text-indigo-700">총수당 예상</th>
                                        <th class="px-2 py-2 text-right text-slate-400 font-extrabold uppercase bg-slate-50/30">15회차 발생분</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${rowsHtml}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <!-- 우측: 그래프 -->
                    <div class="xl:col-span-2 bg-white rounded-3xl p-5 border border-gray-100 shadow-sm flex flex-col">
                        <div class="mb-3">
                            <h3 class="font-extrabold text-gray-800 text-sm flex items-center gap-2">
                                <svg class="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 12l3-3 3 3 4-4M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
                                총수당 예측 그래프 <span class="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-lg ml-1">${currentStartLabel} 기준 16개월</span>
                            </h3>
                        </div>
                        <div class="relative flex-grow h-80 xl:h-[550px]">
                            <canvas id="allowanceForecastChart"></canvas>
                        </div>
                    </div>
                </div>
            `;

            return div;
        }

        // 특정 월 행 클릭 시 그래프 X축 시작 연도월 설정 핸들러
        window.selectForecastMonth = function(ym, event) {
            // 클릭한 요소가 input이나 button이면 스킵
            if (event && (event.target.tagName === 'INPUT' || event.target.tagName === 'BUTTON' || event.target.closest('button') || event.target.closest('input'))) {
                return;
            }
            state.forecastStartMonth = ym;
            render();
            setTimeout(renderTotalAllowanceForecastChart, 100);
        };

        // 입력창 보험료 변경 시 수수료(30%) / 시상금(손보 80%, 생보 70%) 실시간 자동 연산 & 제안
        window.handleForecastPremiumChange = function(month, type, value) {
            const rawVal = Number(value.replace(/,/g, '')) || 0;
            const commInput = document.getElementById(type === 'nonlife' ? `nlComm-${month}` : `lComm-${month}`);
            const awardInput = document.getElementById(type === 'nonlife' ? `nlAward-${month}` : `lAward-${month}`);

            if (type === 'nonlife') {
                if (commInput) commInput.value = 30;
                if (awardInput) awardInput.value = 80;
            } else {
                if (commInput) commInput.value = 30;
                if (awardInput) awardInput.value = 70;
            }

            // 금액 연동 및 수당 업데이트
            handleForecastRatioChange(month, type, 'comm');
            handleForecastRatioChange(month, type, 'award');
            updateForecastRowTotal(month);
        };

        // 비율(%) 변경 시 원화 금액 텍스트 실시간 연동
        window.handleForecastRatioChange = function(month, type, ratioType) {
            const premium = Number((document.getElementById(type === 'nonlife' ? `nlPrem-${month}` : `lPrem-${month}`)?.value || '0').replace(/,/g, '')) || 0;
            const ratio = Number(document.getElementById(type === 'nonlife' ? (ratioType === 'comm' ? `nlComm-${month}` : `nlAward-${month}`) : (ratioType === 'comm' ? `lComm-${month}` : `lAward-${month}`))?.value || '0') || 0;

            const amt = Math.round(premium * (ratio / 100));
            const amtEl = document.getElementById(type === 'nonlife' ? (ratioType === 'comm' ? `nlCommAmt-${month}` : `nlAwardAmt-${month}`) : (ratioType === 'comm' ? `lCommAmt-${month}` : `lAwardAmt-${month}`));

            if (amtEl) amtEl.innerText = amt.toLocaleString() + '원';

            updateForecastRowTotal(month);
        };

        // 행별 예상 총수당 실시간 연산 & DOM 갱신
        window.updateForecastRowTotal = function(month) {
            const nlPrem = Number((document.getElementById(`nlPrem-${month}`)?.value || '0').replace(/,/g, '')) || 0;
            const lPrem = Number((document.getElementById(`lPrem-${month}`)?.value || '0').replace(/,/g, '')) || 0;
            
            const nlCommRatio = Number(document.getElementById(`nlComm-${month}`)?.value || '0') || 0;
            const lCommRatio = Number(document.getElementById(`lComm-${month}`)?.value || '0') || 0;
            const nlAwardRatio = Number(document.getElementById(`nlAward-${month}`)?.value || '0') || 0;
            const lAwardRatio = Number(document.getElementById(`lAward-${month}`)?.value || '0') || 0;

            const nlComm = Math.round(nlPrem * (nlCommRatio / 100));
            const lComm = Math.round(lPrem * (lCommRatio / 100));
            const nlAward = Math.round(nlPrem * (nlAwardRatio / 100));
            const lAward = Math.round(lPrem * (lAwardRatio / 100));

            const incentive = state.actualIncentives[get14MonthsAgoYm(month)] || 0;
            const sum = nlComm + lComm + nlAward + lAward + incentive;

            const totalCell = document.getElementById(`total-${month}`);
            if (totalCell) {
                totalCell.innerText = sum.toLocaleString() + '원';
            }
        };

        // 일괄 저장 버튼 이벤트 핸들러
        window.handleBatchSaveTotalAllowanceForecast = function() {
            const selectedYear = state.forecastSelectedYear || '2026';
            const configsList = [];

            for (let m = 1; m <= 12; m++) {
                const monthStr = String(m).padStart(2, '0');
                const targetYm = selectedYear + monthStr;

                const nonLifePremium = Number((document.getElementById(`nlPrem-${targetYm}`)?.value || '0').replace(/,/g, '')) || 0;
                const lifePremium = Number((document.getElementById(`lPrem-${targetYm}`)?.value || '0').replace(/,/g, '')) || 0;
                const nonLifeComm = Number(document.getElementById(`nlComm-${targetYm}`)?.value || '0') || 0;
                const lifeComm = Number(document.getElementById(`lComm-${targetYm}`)?.value || '0') || 0;
                const nonLifeAward = Number(document.getElementById(`nlAward-${targetYm}`)?.value || '0') || 0;
                const lifeAward = Number(document.getElementById(`lAward-${targetYm}`)?.value || '0') || 0;

                configsList.push({
                    month: targetYm,
                    nonLifePremium,
                    lifePremium,
                    nonLifeComm,
                    lifeComm,
                    nonLifeAward,
                    lifeAward
                });
            }

            saveTotalAllowanceForecastDataBatch(selectedYear, configsList);
        };

        let forecastChartInstance = null;

        // 지급월 매핑 및 16개월 콤보 차트 렌더링
        function renderTotalAllowanceForecastChart() {
            const chartCanvas = document.getElementById('allowanceForecastChart');
            if (!chartCanvas) return;

            if (forecastChartInstance) {
                forecastChartInstance.destroy();
                forecastChartInstance = null;
            }

            const activeYear = state.forecastSelectedYear || '2026';
            
            // X축 지급월 시작월 결정 (기본은 선택 연도에 따라 현재 연월 또는 1월)
            const now = new Date();
            const currentYm = String(now.getFullYear()) + String(now.getMonth() + 1).padStart(2, '0');
            let defaultStartMonth = activeYear + '01';
            if (currentYm.substring(0, 4) === activeYear) {
                defaultStartMonth = currentYm;
            }
            const startMonthYm = state.forecastStartMonth || defaultStartMonth;

            // 1. startMonthYm부터 16개월 연속된 지급월 목록 생성
            const payMonthsToShow = [];
            let currYear = parseInt(startMonthYm.substring(0, 4));
            let currMonth = parseInt(startMonthYm.substring(4, 6));

            for (let i = 0; i < 16; i++) {
                payMonthsToShow.push(String(currYear) + String(currMonth).padStart(2, '0'));
                currMonth++;
                if (currMonth > 12) {
                    currMonth = 1;
                    currYear++;
                }
            }

            // 2. 지급월별 데이터 누적 초기화
            const paymentMap = {};
            payMonthsToShow.forEach(pym => {
                paymentMap[pym] = { nlComm: 0, lComm: 0, nlAward: 0, lAward: 0, incentive: 0 };
            });

            // 3. 202601월부터 마지막 지급월에 영향을 줄 수 있는 모든 실적월 수집
            const maxPayYm = payMonthsToShow[15];
            const allForecastMonths = [];
            let fY = 2026;
            let fM = 1;
            while (true) {
                const ymStr = String(fY) + String(fM).padStart(2, '0');
                if (ymStr > maxPayYm) break;
                allForecastMonths.push(ymStr);
                fM++;
                if (fM > 12) {
                    fM = 1;
                    fY++;
                }
            }

            // 4. 수당 배분 계산 및 누적
            allForecastMonths.forEach(ym => {
                const saved = state.forecastConfigs.find(x => x.month === ym);
                const defaults = getForecastDefaultValues(ym);
                const config = saved || defaults;

                // 2차년인센티브(7번)
                const incentive = state.actualIncentives[ym] || 0;

                const yearNum = parseInt(ym.substring(0, 4));
                const monthNum = parseInt(ym.substring(4, 6));

                // 3,4,5,6번 익월 지급월
                let basicPayMonth = monthNum + 1;
                let basicPayYear = yearNum;
                if (basicPayMonth > 12) {
                    basicPayMonth = 1;
                    basicPayYear += 1;
                }
                const basicPayYm = String(basicPayYear) + String(basicPayMonth).padStart(2, '0');

                // 7번 인센티브 지급월 (전부 15차월 = 실적월 + 14개월 후 지급)
                let incPayMonth = monthNum + 14;
                let incPayYear = yearNum;
                while (incPayMonth > 12) {
                    incPayMonth -= 12;
                    incPayYear += 1;
                }
                const incPayYm = String(incPayYear) + String(incPayMonth).padStart(2, '0');

                // 3,4,5,6번 항목 지급월에 분배
                if (paymentMap[basicPayYm]) {
                    paymentMap[basicPayYm].nlComm += Math.round(config.nonLifePremium * (config.nonLifeComm / 100));
                    paymentMap[basicPayYm].lComm += Math.round(config.lifePremium * (config.lifeComm / 100));
                    paymentMap[basicPayYm].nlAward += Math.round(config.nonLifePremium * (config.nonLifeAward / 100));
                    paymentMap[basicPayYm].lAward += Math.round(config.lifePremium * (config.lifeAward / 100));
                }

                // 7번 인센티브 지급월에 분배 (전부 15차월)
                if (paymentMap[incPayYm]) {
                    paymentMap[incPayYm].incentive += incentive;
                }
            });

            const labels = payMonthsToShow.map(ym => `${ym.substring(2,4)}년 ${parseInt(ym.substring(4,6))}월`);

            // Y축 값 구성 (만원 단위로 변환)
            const nlCommVals = payMonthsToShow.map(ym => Math.round(paymentMap[ym].nlComm / 10000));
            const lCommVals = payMonthsToShow.map(ym => Math.round(paymentMap[ym].lComm / 10000));
            const nlAwardVals = payMonthsToShow.map(ym => Math.round(paymentMap[ym].nlAward / 10000));
            const lAwardVals = payMonthsToShow.map(ym => Math.round(paymentMap[ym].lAward / 10000));
            const incentiveVals = payMonthsToShow.map(ym => Math.round(paymentMap[ym].incentive / 10000));

            // 총수당 합계 라인 값 구성
            const totalVals = payMonthsToShow.map(ym => {
                const item = paymentMap[ym];
                const sum = item.nlComm + item.lComm + item.nlAward + item.lAward + item.incentive;
                return Math.round(sum / 10000);
            });

            // 막대 상단에 만원 단위 총합계를 드로잉하는 커스텀 플러그인
            const topSumPlugin = {
                id: 'topSumPlugin',
                afterDatasetsDraw(chart) {
                    const { ctx, scales: { x, y } } = chart;
                    ctx.save();
                    ctx.font = 'bold 9px sans-serif';
                    ctx.fillStyle = '#4f46e5'; // Indigo 600
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';

                    const datasetCount = chart.data.datasets.length;
                    chart.data.labels.forEach((label, index) => {
                        let total = 0;
                        let topY = y.bottom;
                        let hasBar = false;

                        for (let d = 0; d < datasetCount; d++) {
                            const meta = chart.getDatasetMeta(d);
                            if (meta.hidden) continue;
                            const element = meta.data[index];
                            if (element) {
                                hasBar = true;
                                if (element.y < topY) {
                                    topY = element.y;
                                }
                                total += chart.data.datasets[d].data[index] || 0;
                            }
                        }

                        if (hasBar && total > 0) {
                            const text = total.toLocaleString() + '만';
                            const meta0 = chart.getDatasetMeta(0);
                            const model = meta0.data[index];
                            if (model) {
                                ctx.fillText(text, model.x, topY - 3);
                            }
                        }
                    });
                    ctx.restore();
                }
            };

            const ctx = chartCanvas.getContext('2d');
            forecastChartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: '손보수수료',
                            data: nlCommVals,
                            backgroundColor: '#FB923C', // 주황색
                            stack: 'allowance'
                        },
                        {
                            label: '생보수수료',
                            data: lCommVals,
                            backgroundColor: '#60A5FA', // 파란색
                            stack: 'allowance'
                        },
                        {
                            label: '손보법인시상',
                            data: nlAwardVals,
                            backgroundColor: '#EA580C', // 진한 주황색
                            stack: 'allowance'
                        },
                        {
                            label: '생보법인시상',
                            data: lAwardVals,
                            backgroundColor: '#2563EB', // 진한 파란색
                            stack: 'allowance'
                        },
                        {
                            label: '2차년인센티브',
                            data: incentiveVals,
                            backgroundColor: '#A78BFA', // 보라색
                            stack: 'allowance'
                        }
                    ]
                },
                plugins: [topSumPlugin],
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        mode: 'index',
                        intersect: false
                    },
                    plugins: {
                        legend: {
                            display: true,
                            position: 'bottom',
                            labels: {
                                boxWidth: 10,
                                font: { size: 9, weight: 'bold' }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString()}만원`
                            }
                        }
                    },
                    scales: {
                        y: {
                            stacked: true,
                            beginAtZero: true,
                            grid: { color: '#f8fafc' },
                            ticks: {
                                callback: (v) => v.toLocaleString() + '만',
                                font: { size: 9 }
                            }
                        },
                        x: {
                            stacked: true,
                            grid: { display: false },
                            ticks: { font: { size: 8 } }
                        }
                    }
                }
            });
        }

        async function loadHomeDataDirect() {
            if (!state.user || !state.currentMonth) return;

            const staffId = state.user.staffId;
            const homeCacheKey = `DATA_${staffId}_${state.currentMonth}_home`;
            const lapseCacheKey = `DATA_${staffId}_${state.currentMonth}_lapse`;
            const perfCacheKey = `DATA_${staffId}_${state.currentMonth}_perf`;

            // 1. [0초 즉시 로딩] 세션 캐시가 존재하면 즉시 화면을 렌더링
            try {
                const cachedHome = sessionStorage.getItem(homeCacheKey);
                if (cachedHome) state.data.homeData = JSON.parse(cachedHome);

                const cachedLapse = sessionStorage.getItem(lapseCacheKey);
                if (cachedLapse) state.lapseData = JSON.parse(cachedLapse);

                const cachedPerf = sessionStorage.getItem(perfCacheKey);
                if (cachedPerf) state.performanceData = JSON.parse(cachedPerf);

                if (cachedHome || cachedLapse || cachedPerf) {
                    state.homeLoaded = true;
                    state.lapseLoaded = true;
                    state.performanceLoaded = true;
                    if (state.currentView === 'home') {
                        render();
                        if (state.performanceData) renderPerformanceChart();
                        updateHomeLapseCounts();
                    }
                }
            } catch (e) {
                console.warn('Session cache restore error:', e);
            }

            // 만약 캐시가 하나도 없었던 경우만 로딩 인디케이터 표시
            if (!state.data.homeData || !state.lapseData || !state.performanceData) {
                if (state.currentView === 'home') render();
            }

            // 2. [통합 단일 비동기 동기화] getInitialHomeData 번들 API 단 1회 호출로 초고속 갱신
            try {
                const res = await callApi('getInitialHomeData', staffId);
                if (res && !res.error && res.success) {
                    if (res.homeData) {
                        state.data.homeData = res.homeData;
                        sessionStorage.setItem(homeCacheKey, JSON.stringify(res.homeData));
                    }
                    if (res.lapseData) {
                        state.lapseData = res.lapseData;
                        sessionStorage.setItem(lapseCacheKey, JSON.stringify(res.lapseData));
                    }
                    if (res.performanceData) {
                        state.performanceData = res.performanceData;
                        sessionStorage.setItem(perfCacheKey, JSON.stringify(res.performanceData));
                    }
                }
            } catch (e) {
                console.warn('InitialHomeData bundle fetch error:', e);
                if (!state.data.homeData) state.data.homeData = { retentionRate: '데이터 없음', baseMonth: '-' };
            } finally {
                state.homeLoaded = true;
                state.lapseLoaded = true;
                state.performanceLoaded = true;
                if (state.currentView === 'home') {
                    render();
                    if (state.performanceData) renderPerformanceChart();
                    updateHomeLapseCounts();
                    // 홈 렌더링 완료 후 유휴 시간에 스마트 프리페칭 트리거
                    if (!state.prefetchTriggered) {
                        state.prefetchTriggered = true;
                        setTimeout(prefetchAllBackground, 500);
                    }
                }
            }
        }

        async function fetchHome(key) {
            state.homeLoaded = false;
            render();
            const d = await callApi('getHomeData', state.user.staffId);
            state.homeLoaded = true;

            if (!d.error && d.success) {
                state.data.homeData = d;
                sessionStorage.setItem(key, JSON.stringify(d));
                if (state.currentView === 'home') {
                    render();
                    fetchPerformanceTrend();
                }
            } else {
                state.data.homeData = { retentionRate: '데이터 없음', baseMonth: '-' };
                if (state.currentView === 'home') render();
            }
        }

        async function fetchReward(key) {
            state.isLoading = true; render();
            const d = await callApi('getRewardData', state.user.staffId, state.currentMonth);
            state.isLoading = false;

            if (!d.error) {
                d.month = state.currentMonth;
                state.data.rewardData = d;
                sessionStorage.setItem(key, JSON.stringify(d));
                render();
            } else {
                alert('데이터 로드 실패: ' + d.message);
                render();
            }
        }

        async function fetchBranch(key) {
            state.isLoading = true; render();
            // 시상금데이터와 수수료데이터 동시 호출
            const [rewardRes, commRes] = await Promise.all([
                callApi('getRewardData', state.user.staffId, state.currentMonth),
                callApi('getBranchCommissionData', state.user.staffId, state.currentMonth)
            ]);
            state.isLoading = false;

            if (!rewardRes.error) {
                rewardRes.month = state.currentMonth;
                state.data.rewardData = rewardRes;
                // branch 뷰의 시상금 캐시는 dashboard와 공유
                sessionStorage.setItem(`DATA_${state.user.staffId}_${state.currentMonth} _dashboard`, JSON.stringify(rewardRes));
                sessionStorage.setItem(`DATA_${state.user.staffId}_${state.currentMonth} _branch`, JSON.stringify(rewardRes));
            }

            if (!commRes.error && commRes.success) {
                commRes.month = state.currentMonth;
                state.data.branchCommData = commRes;
            } else {
                // 에러시 빈 값으로 초기화 (화면은 사용 가능)
                state.data.branchCommData = { month: state.currentMonth, lifePay: 0, lifeRefund: 0, nonLifePay: 0, nonLifeRefund: 0 };
                if (commRes.error) console.warn('수수료 데이터 로드 실패:', commRes.message);
            }

            render();
        }
        async function fetchRec(key) {
            state.isLoading = true; render();
            const d = await callApi('getRecruitmentData', state.user.staffId, state.currentMonth);
            state.isLoading = false;

            if (!d.error) {
                d.month = state.currentMonth;
                state.data.recData = d;
                sessionStorage.setItem(key, JSON.stringify(d));
                render();
            } else {
                alert('데이터 로드 실패: ' + d.message);
                render();
            }
        }
        async function fetchAdmin(key) {
            state.isLoading = true; render();
            const d = await callApi('getAdminSummary', state.currentMonth, state.user.staffId);
            state.isLoading = false;

            let parsed = d;
            // Handle double JSON parsing if necessary (sometimes GAS returns stringified JSON)
            if (typeof d === 'string') {
                try { parsed = JSON.parse(d); } catch (e) { parsed = { error: true, message: 'JSON Parse Error' }; }
            }

            state.data.adminSummary = parsed;
            if (!parsed.error && key) sessionStorage.setItem(key, JSON.stringify(parsed));
            render();
        }

        // --- 8.5 Background Pre-fetcher Queue System ---
        let prefetchQueue = [];
        let isPrefetching = false;

        function callApiPrefetch(action, callback, ...args) {
            // [임시 비활성화] 서버 부하 및 404 방지를 위해 백그라운드 프리페치를 차단합니다.
            // 재개하려면 상단의 ENABLE_BACKGROUND_PREFETCH를 true로 설정하세요.
            if (!ENABLE_BACKGROUND_PREFETCH) return;
            if (!state.user) return;
            prefetchQueue.push({ action, callback, args });
            triggerNextPrefetch();
        }

        function triggerNextPrefetch() {
            if (!ENABLE_BACKGROUND_PREFETCH) {
                prefetchQueue = [];
                isPrefetching = false;
                return;
            }
            if (isPrefetching || prefetchQueue.length === 0) return;
            if (!state.user) {
                prefetchQueue = [];
                return;
            }

            isPrefetching = true;
            const item = prefetchQueue.shift();

            // Google Apps Script의 동시 실행 한계(Concurrency Limit)에 걸리지 않도록 
            // 백그라운드 프리페치 호출들을 0.6초(600ms) 간격으로 직렬화하여 순차 실행합니다.
            setTimeout(async () => {
                if (!ENABLE_BACKGROUND_PREFETCH || !state.user) {
                    isPrefetching = false;
                    prefetchQueue = [];
                    return;
                }
                try {
                    const data = await callApi(item.action, ...item.args);
                    if (data && !data.error) {
                        item.callback(data);
                    }
                } catch (e) {
                    console.warn('Prefetch API Error (Bypassed):', e);
                } finally {
                    isPrefetching = false;
                    triggerNextPrefetch();
                }
            }, 600);
        }

        function prefetchAllBackground() {
            // [임시 비활성화] 대시보드 필수 데이터 외의 백그라운드 프리페치 호출을 중단합니다.
            if (!ENABLE_BACKGROUND_PREFETCH) return;
            if (!state.user || !state.currentMonth) return;


            // 0. My Lapsed Contracts (for Home Retention Rate Card Popup)
            const myLapsedCacheKey = `DATA_MY_LAPSED_${state.user.staffId}`;
            if (!sessionStorage.getItem(myLapsedCacheKey)) {
                callApiPrefetch('getLapsedContracts', d => {
                    if (d && !d.error && d.success) {
                        sessionStorage.setItem(myLapsedCacheKey, JSON.stringify(d));
                    }
                }, state.user.staffId);
            }

            // 1. Reward Data
            if (!sessionStorage.getItem(`DATA_${state.user.staffId}_${state.currentMonth}_dashboard`)) {
                callApiPrefetch('getRewardData', d => {
                    d.month = state.currentMonth;
                    sessionStorage.setItem(`DATA_${state.user.staffId}_${state.currentMonth}_dashboard`, JSON.stringify(d));
                    sessionStorage.setItem(`DATA_${state.user.staffId}_${state.currentMonth}_branch`, JSON.stringify(d));
                }, state.user.staffId, state.currentMonth);
            }

            // 1-2. Branch Commission Data (for 지사대표)
            if (state.user.role === '지사대표' && !state.data.branchCommData) {
                callApiPrefetch('getBranchCommissionData', d => {
                    d.month = state.currentMonth;
                    state.data.branchCommData = d;
                    if (state.currentView === 'branch') render();
                }, state.user.staffId, state.currentMonth);
            }

            // 2. Recruitment Data
            if (state.user.isRecruiter && !sessionStorage.getItem(`DATA_${state.user.staffId}_${state.currentMonth}_recruitment`)) {
                callApiPrefetch('getRecruitmentData', d => {
                    d.month = state.currentMonth;
                    sessionStorage.setItem(`DATA_${state.user.staffId}_${state.currentMonth}_recruitment`, JSON.stringify(d));
                }, state.user.staffId, state.currentMonth);
            }

            // 3. Admin Summary
            if ((isBranchRepAny() || isAdminAny()) &&
                !sessionStorage.getItem(`DATA_${state.user.staffId}_${state.currentMonth}_admin`)) {
                callApiPrefetch('getAdminSummary', d => {
                    let parsed = typeof d === 'string' ? (() => { try { return JSON.parse(d); } catch (e) { return d; } })() : d;
                    sessionStorage.setItem(`DATA_${state.user.staffId}_${state.currentMonth}_admin`, JSON.stringify(parsed));

                    // [UX 개선] 관리자 테이블 팝업 미리 캐싱 (Prefetch)
                    if (parsed.reward) {
                        const allMembers = [...(parsed.reward.active || []), ...(parsed.reward.resigned || [])];
                        // 최대 30명까지만 선로딩
                        const membersToPrefetch = allMembers.slice(0, 30);

                        membersToPrefetch.forEach((m) => {
                            const id = String(m.id || m['사번']);
                            const rKey = `DATA_${id}_${state.currentMonth}_dashboard`;
                            if (!sessionStorage.getItem(rKey)) {
                                callApiPrefetch('getRewardData', rd => {
                                    rd.month = state.currentMonth;
                                    sessionStorage.setItem(rKey, JSON.stringify(rd));
                                }, id, state.currentMonth);
                            }

                            if (state.user && state.user.role === '지사대표') {
                                ['nl', 'l', 'm'].forEach(cType => {
                                    ['pay', 'refund'].forEach(pType => {
                                        const cKey = `DATA_COMM_${id}_${state.currentMonth}_${cType}_${pType}`;
                                        if (!sessionStorage.getItem(cKey)) {
                                            callApiPrefetch('getBranchMemberCommissionDetails', cd => {
                                                if (cd && cd.success) sessionStorage.setItem(cKey, JSON.stringify(cd));
                                            }, state.user.staffId, id, state.currentMonth, cType, pType);
                                        }
                                    });
                                });
                            }
                        });
                    }
                }, state.currentMonth, state.user.staffId);
            }


            // 5. Lapse Admin Summary
            if ((isBranchRepAny() || isAdminAny() || hasRole('실장') || isOpsAny()) &&
                !state.data.lapseAdminSummary) {
                callApiPrefetch('getAdminLapseArrearsSummary', res => {
                    if (res.success) {
                        state.data.lapseAdminSummary = res.list || [];
                        state.data.lapseAdminSummary.sort((a, b) => String(a.id).localeCompare(String(b.id)));
                        state.data.lapseAdminSummaryType = 'recruiter';

                        // [UX 개선] 실효연체 팝업 미리 캐싱 (Prefetch)
                        const membersToPrefetch = state.data.lapseAdminSummary.slice(0, 30);
                        membersToPrefetch.forEach((m) => {
                            const cacheKey = `DATA_LAPSE_DETAIL_${m.id}_recruiter`;
                            if (!sessionStorage.getItem(cacheKey)) {
                                callApiPrefetch('getLapseManagementData', ld => {
                                    if (ld && ld.success) sessionStorage.setItem(cacheKey, JSON.stringify(ld));
                                }, m.id, 'recruiter');
                            }
                        });
                    }
                }, state.user.staffId, 'recruiter');
            }

            // 6. Retention Admin Summary
            if ((isBranchRepAny() || isAdminAny() || hasRole('실장') || isOpsAny()) &&
                !state.data.retentionAdminSummary) {
                callApiPrefetch('getAdminRetentionSummary', res => {
                    if (res.success) {
                        state.data.retentionAdminSummary = res.list || [];

                        // [UX 개선] 통산유지율 팝업 미리 캐싱 (Prefetch)
                        const membersToPrefetch = state.data.retentionAdminSummary.slice(0, 30);
                        membersToPrefetch.forEach((m) => {
                            const cacheKey = `DATA_LAPSED_REC_${state.user.staffId}_${m.id}`;
                            if (!sessionStorage.getItem(cacheKey)) {
                                callApiPrefetch('getLapsedContractsByRecruiter', rd => {
                                    if (rd && rd.success) sessionStorage.setItem(cacheKey, JSON.stringify(rd));
                                }, state.user.staffId, m.id);
                            }
                        });
                    }
                }, state.user.staffId);
            }

            // 7. New Contracts (Both NL and L)
            if (state.user.role === '지사대표') {
                if (!state.data.newContractNl || state.data.newContractNl_month !== state.currentMonth) {
                    callApiPrefetch('getNewContractList', res => {
                        state.data.newContractNl = res.list || [];
                        state.data.newContractNl_month = state.currentMonth;
                    }, state.user.staffId, state.currentMonth, 'nl');
                }
                if (!state.data.newContractL || state.data.newContractL_month !== state.currentMonth) {
                    callApiPrefetch('getNewContractList', res => {
                        state.data.newContractL = res.list || [];
                        state.data.newContractL_month = state.currentMonth;
                    }, state.user.staffId, state.currentMonth, 'l');
                }
            }

            // 8. Activity Data Prefetch (활동관리 사전 캐싱)
            if (!state.activityState) {
                state.activityState = {
                    year: String(_todayW.year),
                    week: String(_todayW.week),
                    statsYear: String(_todayW.year),
                    data: null,
                    loaded: false
                };
            }
            if (!state.activityState.loaded) {
                const as = state.activityState;
                callApiPrefetch('getActivityData', res => {
                    if (res && res.success) {
                        as.data = res;
                        as.loaded = true;
                    }
                }, state.user.staffId, as.year, as.week);
            }

            // 9. Performance Analysis Prefetch (실적분석 사전 캐싱)
            if ((isBranchRepAny() || isOpsAny() || hasRole('실장') || hasRole('실적분석')) &&
                !state.perfAnalysisLoaded) {
                const now = new Date();
                let perfYear = state.perfAnalysisYear || String(now.getFullYear());
                let perfMonth = state.perfAnalysisMonth || 'All';

                // 2026년 1월 하한선 적용
                if (perfYear < '2026') {
                    perfYear = '2026';
                    perfMonth = '01';
                } else if (perfYear === '2026' && perfMonth !== 'All' && perfMonth < '01') {
                    perfMonth = '01';
                }
                state.perfAnalysisYear = perfYear;
                state.perfAnalysisMonth = perfMonth;

                callApiPrefetch('getPerformanceAnalysisData', res => {
                    if (res && res.success) {
                        state.perfAnalysisData = res;
                        state.perfAnalysisLoaded = true;
                    }
                }, state.user.staffId, perfYear, perfMonth);
            }

            // 10. Bond Management Prefetch (채권관리 사전 캐싱)
            if (state.user.role === '지사대표' && !state.bondLoaded) {
                callApiPrefetch('getBondManagementData', res => {
                    if (res && res.success) {
                        state.bondData = res.list || [];
                        state.bondTargetMonth = res.month || '';
                        state.bondDataMonth = state.currentMonth;
                        state.bondUpdates = {};
                        state.bondLoaded = true;
                    }
                }, state.user.staffId, '');
            }
        }

        // --- 9. Password Change ---
        function openChangePasswordModal(canCancel) {
            document.body.classList.add('modal-open');
            const m = document.getElementById('pw-modal');
            m.classList.remove('hidden');
            const cancelBtn = document.getElementById('pwCancelBtn');
            // Show/Hide cancel button (it's the first button in the div usually, or select by ID)
            if (cancelBtn) {
                cancelBtn.style.visibility = canCancel ? 'visible' : 'hidden'; // Don't remove from layout to keep alignment? Or display none.
                cancelBtn.style.display = canCancel ? 'block' : 'none';
            }
        }

        function closePwModal() {
            document.body.classList.remove('modal-open');
            document.getElementById('pw-modal').classList.add('hidden');
        }

        document.getElementById('pwForm').addEventListener('submit', async function (e) {
            e.preventDefault();
            const p1 = document.getElementById('newPw').value;
            const p2 = document.getElementById('confirmPw').value;
            if (p1 !== p2) { alert('비밀번호가 일치하지 않습니다.'); return; }
            if (p1.length < 4) { alert('비밀번호는 4자리 이상이어야 합니다.'); return; }
            showLoading(true);
            const res = await callApi('changePassword', state.user.staffId, p1);
            showLoading(false);
            if (res.success) {
                alert('비밀번호가 변경되었습니다. 다시 로그인해주세요.');
                closePwModal();
                logout();
            } else {
                alert('실패: ' + (res.message || ' Unknown Error'));
            }
        });

        // --- 10. Initialization --- 
        document.addEventListener('DOMContentLoaded', () => {
            // Check if already on a specific route without session
            if (restoreSession()) {
                refresh();
            } else {
                render(); // shows login
            }
        });

