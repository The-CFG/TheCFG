// ── Supabase 클라이언트 (auth.js 로드 시점에 초기화) ───────
const SUPABASE_URL = 'https://uzokrwwzksgunrcdjlug.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6b2tyd3d6a3NndW5yY2RqbHVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MDQ3OTMsImV4cCI6MjA5NDA4MDc5M30.WZcxh7bhpILqed15vnBof-E1LXkAEXLdxO2UY43iYJU';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let isSignUpMode = false;

const CloudAuth = {
    // ── 기본 인증 ──────────────────────────────────────────
    async getUser() {
        const { data: { user } } = await _supabase.auth.getUser();
        return user;
    },

    async signUp(email, password) {
        return await _supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: undefined }
        });
    },

    async login(email, password) {
        return await _supabase.auth.signInWithPassword({ email, password });
    },

    async logout() {
        await _supabase.auth.signOut();
        _updateAuthStatus(null);
    },

    // ── 계정 설정 ──────────────────────────────────────────
    // 비밀번호 변경
    async updatePassword(newPassword) {
        return await _supabase.auth.updateUser({ password: newPassword });
    },

    // 계정 탈퇴
    // 주의: Supabase JS 클라이언트는 자기 계정 삭제 API를 제공하지 않으므로,
    // DB에 SECURITY DEFINER 로 정의된 RPC 함수 'delete_user' 가 있어야 완전히 삭제됩니다.
    // (CREATE FUNCTION delete_user() ... 안에서 auth.users 에서 본인 행을 삭제)
    // RPC 함수가 없는 경우에도 사용자 데이터(projects/project_files)는 정리하고 로그아웃합니다.
    async deleteAccount() {
        const user = await this.getUser();
        if (!user) throw new Error('로그인 상태가 아닙니다.');

        // 1) 사용자 데이터 정리 (프로젝트 / 파일 / Storage)
        try {
            await _supabase.from('project_files').delete().eq('user_id', user.id);
            await _supabase.from('projects').delete().eq('user_id', user.id);
        } catch (e) {
            console.warn('계정 데이터 삭제 중 오류:', e.message);
        }

        // 2) 인증 계정 삭제 (RPC 필요)
        let authDeleted = false;
        try {
            const { error } = await _supabase.rpc('delete_user');
            if (!error) authDeleted = true;
            else console.warn('delete_user RPC 오류:', error.message);
        } catch (e) {
            console.warn('delete_user RPC 호출 실패:', e.message);
        }

        // 3) 로그아웃
        await _supabase.auth.signOut();
        _updateAuthStatus(null);

        return { authDeleted };
    },

    // ── 프로젝트 목록 조회 (projects 테이블) ────────────────
    // 반환: [{ name, updated_at }, ...]
    async listProjects() {
        const user = await this.getUser();
        if (!user) return [];
        const { data, error } = await _supabase
            .from('projects')
            .select('name, updated_at')
            .eq('user_id', user.id)
            .order('updated_at', { ascending: false });
        if (error) { console.error('listProjects 오류:', error.message); return []; }
        return data || [];
    },

    // ── 유저 프로필 ──────────────────────────────────────────

    // 프로필 조회 (본인)
    async getProfile() {
        const user = await this.getUser();
        if (!user) return null;
        const { data, error } = await _supabase
            .from('user_profiles')
            .select('nickname, settings, updated_at')
            .eq('user_id', user.id)
            .single();
        if (error) { console.warn('getProfile 오류:', error.message); return null; }
        return data;
    },

    // 특정 user_id의 닉네임 조회 (공동 작업 UI용)
    async getNicknameByUserId(userId) {
        const map = await this._fetchNicknameMap([userId]);
        return map[userId] || null;
    },

    // 여러 userId → nickname 맵 일괄 조회 (내부 헬퍼)
    // 반환: { [userId]: nickname | null }
    async _fetchNicknameMap(userIds) {
        if (!userIds.length) return {};
        // RPC(SECURITY DEFINER)로 호출 — user_profiles RLS 우회
        const { data, error } = await _supabase
            .rpc('get_nicknames_by_ids', { user_ids: userIds });
        if (error) {
            console.warn('_fetchNicknameMap RPC 오류:', error.message);
            return {};
        }
        const map = {};
        for (const row of (data || [])) map[row.user_id] = row.nickname || null;
        return map;
    },

    // 닉네임 저장 (user_profiles)
    async updateNickname(nickname) {
        const user = await this.getUser();
        if (!user) throw new Error('로그인 상태가 아닙니다.');
        const { error } = await _supabase
            .from('user_profiles')
            .upsert({ user_id: user.id, nickname, updated_at: new Date().toISOString() },
                    { onConflict: 'user_id' });
        if (error) throw error;
    },

    // 앱 설정 저장 (user_profiles.settings jsonb)
    async saveSettings(settings) {
        const user = await this.getUser();
        if (!user) return;
        const { error } = await _supabase
            .from('user_profiles')
            .upsert({ user_id: user.id, settings, updated_at: new Date().toISOString() },
                    { onConflict: 'user_id' });
        if (error) console.warn('saveSettings 오류:', error.message);
    },

    // 앱 설정 불러오기
    async loadSettings() {
        const profile = await this.getProfile();
        return profile?.settings || null;
    },

    // ── 공동 작업 — 멤버 관리 ───────────────────────────────

    // 현재 프로젝트의 내 역할 조회
    // 반환: 'owner' | 'editor' | 'viewer' | null
    async getMyRole(ownerUserId, projectName) {
        const user = await this.getUser();
        if (!user) return null;
        if (user.id === ownerUserId) return 'owner';
        const { data, error } = await _supabase
            .from('project_members')
            .select('role')
            .eq('owner_id', ownerUserId)
            .eq('project_name', projectName)
            .eq('member_id', user.id)
            .single();
        if (error) return null;
        return data?.role || null;
    },

    // 멤버 목록 조회 (닉네임 포함)
    // 반환: [{ member_id, role, joined_at, nickname }]
    async listMembers(ownerUserId, projectName) {
        const { data, error } = await _supabase
            .from('project_members')
            .select(`
                member_id,
                role,
                joined_at,
                user_profiles ( nickname )
            `)
            .eq('owner_id', ownerUserId)
            .eq('project_name', projectName)
            .order('joined_at', { ascending: true });
        if (error) { console.error('listMembers 오류:', error.message); return []; }
        return (data || []).map(m => ({
            member_id: m.member_id,
            role:      m.role,
            joined_at: m.joined_at,
            nickname:  m.user_profiles?.nickname || null,
        }));
    },

    // 이메일로 멤버 초대
    // 반환: { ok: true } | { ok: false, error: string }
    async inviteMember(ownerUserId, projectName, email, role = 'editor') {
        const user = await this.getUser();
        if (!user || user.id !== ownerUserId)
            return { ok: false, error: '소유자만 초대할 수 있습니다.' };

        // 자기 자신 초대 방지
        if (email === user.email)
            return { ok: false, error: '본인은 초대할 수 없습니다.' };

        const { error } = await _supabase
            .from('project_invites')
            .upsert({
                owner_id:      ownerUserId,
                project_name:  projectName,
                invited_email: email,
                role,
                status:        'pending',
                created_at:    new Date().toISOString(),
            }, { onConflict: 'owner_id,project_name,invited_email' });

        if (error) return { ok: false, error: error.message };
        return { ok: true };
    },

    // 멤버 역할 변경 (소유자만)
    async updateMemberRole(ownerUserId, projectName, memberId, newRole) {
        const { error } = await _supabase
            .from('project_members')
            .update({ role: newRole })
            .eq('owner_id', ownerUserId)
            .eq('project_name', projectName)
            .eq('member_id', memberId);
        if (error) throw error;
    },

    // 멤버 제거 (소유자가 강퇴 또는 본인이 나가기)
    async removeMember(ownerUserId, projectName, memberId) {
        const { error } = await _supabase
            .from('project_members')
            .delete()
            .eq('owner_id', ownerUserId)
            .eq('project_name', projectName)
            .eq('member_id', memberId);
        if (error) throw error;
    },

    // ── 공동 작업 — 초대 관리 ───────────────────────────────

    // 내가 받은 pending 초대 목록
    // 반환: [{ id, owner_id, project_name, role, created_at, owner_nickname }]
    async listReceivedInvites() {
        const user = await this.getUser();
        if (!user) return [];
        const { data, error } = await _supabase
            .from('project_invites')
            .select('id, owner_id, project_name, role, created_at')
            .eq('invited_email', user.email)
            .eq('status', 'pending')
            .order('created_at', { ascending: false });
        if (error) { console.warn('listReceivedInvites 오류:', error.message); return []; }
        const invites = data || [];
        // 소유자 닉네임 일괄 조회 (표시용)
        const ownerIds = [...new Set(invites.map(i => i.owner_id))];
        const nickMap  = await this._fetchNicknameMap(ownerIds);
        return invites.map(inv => ({
            id:             inv.id,
            owner_id:       inv.owner_id,
            project_name:   inv.project_name,
            role:           inv.role,
            created_at:     inv.created_at,
            owner_nickname: nickMap[inv.owner_id] || null,
        }));
    },

    // 내가 보낸 초대 목록 (프로젝트별)
    // 반환: [{ id, invited_email, role, status, created_at }]
    async listSentInvites(ownerUserId, projectName) {
        const { data, error } = await _supabase
            .from('project_invites')
            .select('id, invited_email, role, status, created_at')
            .eq('owner_id', ownerUserId)
            .eq('project_name', projectName)
            .order('created_at', { ascending: false });
        if (error) { console.warn('listSentInvites 오류:', error.message); return []; }
        return data || [];
    },

    // 초대 수락 (RPC)
    async acceptInvite(inviteId) {
        const { error } = await _supabase.rpc('accept_project_invite', { invite_id: inviteId });
        if (error) throw error;
    },

    // 초대 거절
    async declineInvite(inviteId) {
        const { error } = await _supabase
            .from('project_invites')
            .update({ status: 'declined' })
            .eq('id', inviteId);
        if (error) throw error;
    },

    // 초대 취소 (소유자가 보낸 초대 삭제)
    async cancelInvite(inviteId) {
        const { error } = await _supabase
            .from('project_invites')
            .delete()
            .eq('id', inviteId);
        if (error) throw error;
    },

    // ── 공동 작업 — 공유받은 프로젝트 ──────────────────────

    // 내가 멤버로 참여 중인 프로젝트 목록
    // 반환: [{ owner_id, project_name, role, joined_at, owner_nickname, updated_at }]
    async listSharedProjects() {
        const user = await this.getUser();
        if (!user) return [];
        const { data, error } = await _supabase
            .from('project_members')
            .select('owner_id, project_name, role, joined_at')
            .eq('member_id', user.id)
            .order('joined_at', { ascending: false });
        if (error) { console.warn('listSharedProjects 오류:', error.message); return []; }
        const members = data || [];
        // 소유자 닉네임 일괄 조회 (표시용)
        const ownerIds = [...new Set(members.map(m => m.owner_id))];
        const nickMap  = await this._fetchNicknameMap(ownerIds);
        return members.map(m => ({
            owner_id:       m.owner_id,
            project_name:   m.project_name,
            role:           m.role,
            joined_at:      m.joined_at,
            owner_nickname: nickMap[m.owner_id] || null,
            updated_at:     null,
        }));
    },

    // 공유 프로젝트 로드 (소유자 user_id + project_name 으로 파일 조회)
    async loadSharedProject(ownerUserId, projectName) {
        const { data, error } = await _supabase
            .from('project_files')
            .select('file_path, file_type, content, storage_path, updated_at')
            .eq('user_id', ownerUserId)
            .eq('project_name', projectName);
        if (error) { console.error('loadSharedProject 오류:', error.message); return null; }
        return data || [];
    },

    // ── 프로젝트 메타 upsert (projects 테이블) ───────────────
    async _saveProjectMeta(userId, name) {
        const { error } = await _supabase.from('projects').upsert({
            user_id: userId,
            name,
            updated_at: new Date().toISOString()
        }, { onConflict: 'user_id,name' });
        if (error) console.error('프로젝트 메타 저장 오류:', error.message);
    },

    // ── 프로젝트 저장 (파일별 분리) ─────────────────────────
    // onProgress(pct, detail) — 0~100, 현재 작업 설명 문자열
    async saveProject(projectName, onProgress = null) {
        if (!projectName) return;
        const user = await this.getUser();
        if (!user) return;

        const files = appState?.project?.files;
        if (!files) return;

        const report = (pct, detail) => onProgress?.(Math.round(pct), detail);

        report(0, '프로젝트 메타 저장 중...');
        await this._saveProjectMeta(user.id, projectName);

        const rows       = [];
        const imgUploads = []; // { filePath, fd, storagePath }

        // ── 1. 텍스트 파일 행 수집 + 이미지 PNG 변환 ────────
        report(2, '이미지 변환 중...');
        const imgEntries = Object.entries(files).filter(([, fd]) =>
            fd && (fd.type === 'dds' || fd.type === 'image') && fd.base64
        );
        // stub 파일(base64 없음) — project_files에 storage_path placeholder 행 등록
        // 실제 바이너리는 이미 Storage에 있으므로 row만 만들어 다음 로드에서 인식되게 함
        const stubEntries = Object.entries(files).filter(([, fd]) =>
            fd && (fd.type === 'dds' || fd.type === 'image') && fd._stub && !fd.base64
        );
        if (stubEntries.length) {
            const stubRows = stubEntries.map(([filePath, fd]) => ({
                user_id:      user.id,
                project_name: projectName,
                file_path:    filePath,
                file_type:    fd.type,
                content:      null,
                storage_path: `${user.id}/${projectName}/${filePath}`,
                updated_at:   new Date().toISOString()
            }));
            for (let i = 0; i < stubRows.length; i += 200) {
                const { error } = await _supabase.from('project_files')
                    .upsert(stubRows.slice(i, i + 200), { onConflict: 'user_id,project_name,file_path' });
                if (error) console.error('stub 행 등록 오류:', error.message);
            }
            console.log(`[클라우드] stub 파일 ${stubEntries.length}개 행 등록`);
        }
        const textEntries = Object.entries(files).filter(([, fd]) =>
            fd && fd.type !== 'dds' && fd.type !== 'image'
        );

        // 이미지 PNG 변환 (병렬 4개씩)
        // storagePath와 file_path 모두 원본 경로 유지 — 내부 바이너리만 PNG로 압축
        const PARA = 4;
        const converted = new Array(imgEntries.length);
        for (let i = 0; i < imgEntries.length; i += PARA) {
            const batch = imgEntries.slice(i, i + PARA);
            report(2 + (i / imgEntries.length) * 13,
                `이미지 변환 중... (${i + 1}–${Math.min(i + PARA, imgEntries.length)} / ${imgEntries.length})`);
            await Promise.all(batch.map(async ([filePath, fd], bi) => {
                const ext = filePath.split('.').pop().toLowerCase();
                let finalBase64 = fd.base64; // 기본값: 원본 그대로
                try {
                    if (ext === 'dds' && fd.base64 && !fd.base64.startsWith('data:')) {
                        // 레거시 DDS 원본 → Canvas로 PNG 변환 후 저장
                        const pngDataUrl = _ddsBase64ToDataUrl(fd.base64);
                        if (pngDataUrl) {
                            finalBase64 = pngDataUrl.replace(/^data:image\/png;base64,/, '');
                            // 메모리 상의 fd도 갱신 — 다음 저장부터 재변환 불필요
                            files[filePath] = { ...fd, base64: `data:image/png;base64,${finalBase64}` };
                        }
                    } else {
                        const { base64: pngB64 } = await compressImageToPng(fd.base64, ext);
                        if (pngB64 && pngB64.length > 0) finalBase64 = pngB64;
                    }
                } catch(e) {
                    console.warn(`PNG 변환 실패, 원본 유지 (${filePath}):`, e);
                }
                converted[i + bi] = {
                    filePath,
                    // storagePath도 원본 경로 그대로 — 확장자 불일치 방지
                    storagePath: `${user.id}/${projectName}/${filePath}`,
                    base64: finalBase64,
                    type: fd.type
                };
            }));
        }

        for (const c of converted) {
            if (c?.filePath && c?.base64) imgUploads.push(c);
        }

        // 텍스트 파일 행 수집
        for (const [filePath, fd] of textEntries) {
            if (!fd) continue;
            let content = null;
            if (fd.type === 'national_focus')    content = buildFocusTxt(fd);
            else if (fd.type === 'localisation') content = buildLocYml(fd);
            else if (fd.type === 'gfx_define')   content = buildGfxFile(fd);
            else if (fd.type === 'ideas')        content = buildIdeasTxt(fd);
            else if (fd.type === 'decisions')    content = buildDecisionsTxt(fd);
            else if (fd.type === 'decisions_category') content = buildDecisionCategoriesTxt(fd);
            else if (fd.raw != null)              content = fd.raw;
            else                                  content = JSON.stringify(fd);
            rows.push({
                user_id:      user.id,
                project_name: projectName,
                file_path:    filePath,
                file_type:    fd.type || 'raw',
                content:      content,
                storage_path: null,
                updated_at:   new Date().toISOString()
            });
        }

        const total = rows.length + imgUploads.length || 1;
        let done = 0;

        // ── 2. 텍스트 파일 일괄 upsert (200개씩) ────────────
        const CHUNK = 200;
        for (let i = 0; i < rows.length; i += CHUNK) {
            const chunk = rows.slice(i, i + CHUNK);
            report(15 + (done / total) * 70,
                `텍스트 저장 중... (${Math.min(i + CHUNK, rows.length)} / ${rows.length})`);
            const { error } = await _supabase
                .from('project_files')
                .upsert(chunk, { onConflict: 'user_id,project_name,file_path' });
            if (error) console.error('project_files upsert 오류:', error.message);
            done += chunk.length;
        }

        // ── 3. 이미지 Storage 업로드 (병렬 4개씩) ───────────
        let imgDone = 0;
        for (let i = 0; i < imgUploads.length; i += PARA) {
            const batch = imgUploads.slice(i, i + PARA);
            report(15 + (done / total) * 70,
                `이미지 업로드 중... (${i + 1}–${Math.min(i + PARA, imgUploads.length)} / ${imgUploads.length})`);
            await Promise.all(batch.map(async ({ filePath, storagePath, base64, type }) => {
                try {
                    const b64clean = base64.replace(/^data:[^;]+;base64,/, '');
                    const byteStr  = atob(b64clean);
                    const arr      = new Uint8Array(byteStr.length);
                    for (let b = 0; b < byteStr.length; b++) arr[b] = byteStr.charCodeAt(b);

                    const { error: upErr } = await _supabase.storage
                        .from('mod-images')
                        .upload(storagePath, arr, { upsert: true });
                    if (upErr) { console.error('이미지 업로드 오류:', upErr.message); return; }

                    const { error: rowErr } = await _supabase
                        .from('project_files')
                        .upsert({
                            user_id:      user.id,
                            project_name: projectName,
                            file_path:    filePath,
                            file_type:    type,
                            content:      null,
                            storage_path: storagePath,
                            updated_at:   new Date().toISOString()
                        }, { onConflict: 'user_id,project_name,file_path' });
                    if (rowErr) console.error('이미지 행 upsert 오류:', rowErr.message);
                } catch (e) {
                    console.error(`이미지 처리 실패 (${filePath}):`, e);
                }
                imgDone++;
            }));
            done += batch.length;
        }

        report(100, '저장 완료!');
        console.log(`[클라우드] "${projectName}" 저장 완료 (텍스트 ${rows.length}개, 이미지 ${imgUploads.length}개)`);
    },

    // ── 프로젝트 파일 목록만 조회 (지연 로딩용) ─────────────
    async loadProjectMeta(projectName) {
        const user = await this.getUser();
        if (!user) return null;

        // 1. project_files 테이블에서 목록 조회
        const { data, error } = await _supabase
            .from('project_files')
            .select('file_path, file_type')
            .eq('user_id', user.id)
            .eq('project_name', projectName);

        if (error) { console.error('loadProjectMeta 오류:', error.message); return null; }

        const files = {};
        for (const { file_path, file_type } of (data || [])) {
            files[file_path] = { type: file_type, _stub: true };
        }

        // 2. Storage 버킷 재귀 스캔 — project_files에 없는 레거시 파일 보완
        try {
            const storageBase = `${user.id}/${projectName}`;
            const allItems    = await _listStorageRecursive('mod-images', storageBase);
            for (const storagePath of allItems) {
                // storagePath = "userId/projectName/gfx/interface/goals/foo.dds"
                // file_path   = "gfx/interface/goals/foo.dds"
                const filePath = storagePath.slice(storageBase.length + 1);
                if (!files[filePath]) {
                    const ext  = filePath.split('.').pop().toLowerCase();
                    const type = ext === 'dds' ? 'dds' : 'image';
                    files[filePath] = { type, _stub: true };
                    console.log(`[레거시] Storage에서 발견: ${filePath}`);
                }
            }
        } catch(e) {
            console.warn('Storage 스캔 실패 (무시):', e.message);
        }

        if (!Object.keys(files).length) return null;

        console.log(`[클라우드] "${projectName}" 목록 로드 (${Object.keys(files).length}개 파일)`);
        return { name: projectName, files };
    },

    // ── 단일 파일 내용 로드 (지연 로딩) ─────────────────────
    // stub 상태인 파일을 서버에서 실제 내용으로 교체
    // 반환: 파일 데이터 객체 또는 null
    async fetchFile(projectName, filePath, fileType) {
        const user = await this.getUser();
        if (!user) return null;

        const { data, error } = await _supabase
            .from('project_files')
            .select('file_type, content, storage_path')
            .eq('user_id', user.id)
            .eq('project_name', projectName)
            .eq('file_path', filePath)
            .maybeSingle();

        if (error) { console.error('fetchFile 오류:', error.message); return null; }

        // project_files 행이 없는 레거시 파일 — Storage에서 직접 다운로드 후 행 등록
        if (!data) {
            const storagePath = `${user.id}/${projectName}/${filePath}`;
            const { data: blob, error: dlErr } = await _supabase.storage
                .from('mod-images').download(storagePath);
            if (dlErr) { console.error('레거시 파일 다운로드 오류:', dlErr.message); return null; }
            const buf    = await blob.arrayBuffer();
            const format = _detectImageFormat(buf);
            const b64    = _arrayBufferToBase64Io(buf);
            const type   = fileType || (format === 'dds' ? 'dds' : 'image');
            // project_files에 행 등록 — 다음 로드부터 테이블에서 인식됨
            await _supabase.from('project_files').upsert({
                user_id:      user.id,
                project_name: projectName,
                file_path:    filePath,
                file_type:    type,
                content:      null,
                storage_path: storagePath,
                updated_at:   new Date().toISOString()
            }, { onConflict: 'user_id,project_name,file_path' });
            return format === 'dds'
                ? { type, base64: b64 }
                : { type, base64: `data:image/png;base64,${b64}` };
        }

        const { file_type, content, storage_path } = data;

        // 이미지 → Storage download
        // 레거시: 구버전은 DDS 원본 그대로 저장, 신버전은 PNG로 변환 저장
        // → 매직 바이트로 실제 포맷을 감지해 처리
        if (storage_path) {
            const { data: blob, error: dlErr } = await _supabase.storage
                .from('mod-images').download(storage_path);
            if (dlErr) { console.error('이미지 다운로드 오류:', dlErr.message); return null; }
            const buf    = await blob.arrayBuffer();
            const format = _detectImageFormat(buf);
            const b64    = _arrayBufferToBase64Io(buf);
            if (format === 'dds') {
                // 레거시 DDS — 원본 그대로 보존 (렌더링은 _ddsBase64ToDataUrl이 처리)
                return { type: file_type, base64: b64 };
            } else {
                // PNG(또는 기타) — data: 헤더 붙여서 반환
                const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
                return { type: file_type, base64: `data:${mime};base64,${b64}` };
            }
        }

        // 텍스트 파일
        if (file_type === 'national_focus' || file_type === 'localisation'
            || file_type === 'gfx_define'  || file_type === 'gui'
            || file_type === 'ideas'
            || file_type === 'decisions'   || file_type === 'decisions_category') {
            const filename = filePath.split('/').pop();
            const parsed   = parseSingleFile(content, filename, filePath);
            return parsed || { type: file_type, raw: content };
        }
        try   { return JSON.parse(content); }
        catch { return { type: file_type, raw: content }; }
    },

    // ── 공유 프로젝트 단일 파일 내용 로드 (초대받은 사용자용) ─
    // 소유자의 user_id 기준으로 project_files 조회
    async fetchSharedFile(ownerUserId, projectName, filePath, fileType) {
        const { data, error } = await _supabase
            .from('project_files')
            .select('file_type, content, storage_path')
            .eq('user_id', ownerUserId)
            .eq('project_name', projectName)
            .eq('file_path', filePath)
            .maybeSingle();

        if (error) { console.error('fetchSharedFile 오류:', error.message); return null; }
        if (!data) { console.warn('fetchSharedFile: 행 없음', filePath); return null; }

        const { file_type, content, storage_path } = data;

        // 이미지 → Public URL 또는 Signed URL 경유 다운로드
        if (storage_path) {
            // 먼저 Public URL 시도 (버킷이 public이면 바로 성공)
            let buf = null;
            const { data: pubData } = _supabase.storage
                .from('mod-images').getPublicUrl(storage_path);
            if (pubData?.publicUrl) {
                try {
                    const res = await fetch(pubData.publicUrl);
                    if (res.ok) buf = await res.arrayBuffer();
                } catch (_) { /* public 실패 시 signed URL로 폴백 */ }
            }
            // Public URL 실패 시 Signed URL로 폴백
            if (!buf) {
                const { data: signedData, error: signErr } = await _supabase.storage
                    .from('mod-images').createSignedUrl(storage_path, 120);
                if (signErr || !signedData?.signedUrl) {
                    console.error('공유 이미지 URL 발급 오류:', signErr?.message); return null;
                }
                try {
                    const res = await fetch(signedData.signedUrl);
                    if (!res.ok) { console.error('공유 이미지 fetch 실패:', res.status); return null; }
                    buf = await res.arrayBuffer();
                } catch (e) {
                    console.error('공유 이미지 다운로드 오류:', e); return null;
                }
            }
            const format = _detectImageFormat(buf);
            const b64    = _arrayBufferToBase64Io(buf);
            if (format === 'dds') {
                return { type: file_type, base64: b64 };
            } else {
                const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
                return { type: file_type, base64: `data:${mime};base64,${b64}` };
            }
        }

        // 텍스트 파일
        if (file_type === 'national_focus' || file_type === 'localisation'
            || file_type === 'gfx_define'  || file_type === 'gui'
            || file_type === 'ideas'
            || file_type === 'decisions'   || file_type === 'decisions_category') {
            const filename = filePath.split('/').pop();
            const parsed   = parseSingleFile(content, filename, filePath);
            return parsed || { type: file_type, raw: content };
        }
        try   { return JSON.parse(content); }
        catch { return { type: file_type, raw: content }; }
    },

    // ── 프로젝트 로드 (전체 — stub 없이 모든 content 포함) ─
    async loadProject(projectName, onProgress = null) {
        const user = await this.getUser();
        if (!user) return null;

        const report = (pct, detail) => onProgress?.(Math.round(pct), detail);

        report(5, '파일 목록 조회 중...');
        const { data, error } = await _supabase
            .from('project_files')
            .select('file_path, file_type, content, storage_path')
            .eq('user_id', user.id)
            .eq('project_name', projectName);

        if (error) { console.error('loadProject 오류:', error.message); return null; }
        if (!data || data.length === 0) return null;

        const files = {};
        const imgRows  = data.filter(r => r.storage_path);
        const textRows = data.filter(r => !r.storage_path);
        const total    = data.length || 1;
        let done       = 0;

        // 텍스트 파일 복원
        for (const row of textRows) {
            const { file_path, file_type, content } = row;
            report(10 + (done / total) * 70, `텍스트 파일 복원 중... ${file_path.split('/').pop()}`);
            if (file_type === 'national_focus' || file_type === 'localisation'
                || file_type === 'gfx_define'  || file_type === 'gui'
                || file_type === 'ideas'
                || file_type === 'decisions'   || file_type === 'decisions_category') {
                const filename = file_path.split('/').pop();
                const parsed   = parseSingleFile(content, filename, file_path);
                files[file_path] = parsed || { type: file_type, raw: content };
            } else {
                try   { files[file_path] = JSON.parse(content); }
                catch { files[file_path] = { type: file_type, raw: content }; }
            }
            done++;
        }

        // 이미지 파일 복원 (Storage download — 병렬 4개씩)
        const PARA = 4;
        for (let i = 0; i < imgRows.length; i += PARA) {
            const batch = imgRows.slice(i, i + PARA);
            report(10 + (done / total) * 70,
                `이미지 다운로드 중... (${i + 1}–${Math.min(i + PARA, imgRows.length)} / ${imgRows.length})`);
            await Promise.all(batch.map(async ({ file_path, file_type, storage_path }) => {
                try {
                    const { data: blob, error: dlErr } = await _supabase.storage
                        .from('mod-images').download(storage_path);
                    if (dlErr) { console.error('이미지 다운로드 오류:', dlErr.message); return; }
                    // FileReader 대신 arrayBuffer 직통 (빠름)
                    const buf    = await blob.arrayBuffer();
                    const format = _detectImageFormat(buf);
                    const b64    = _arrayBufferToBase64Io(buf);
                    if (format === 'dds') {
                        files[file_path] = { type: file_type, base64: b64 };
                    } else {
                        const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
                        files[file_path] = { type: file_type, base64: `data:${mime};base64,${b64}` };
                    }
                } catch (e) {
                    console.error(`이미지 복원 실패 (${file_path}):`, e);
                }
            }));
            done += batch.length;
        }

        report(100, '불러오기 완료!');
        console.log(`[클라우드] "${projectName}" 로드 완료 (파일 ${Object.keys(files).length}개)`);
        return { name: projectName, files };
    },

    // ── 단일 파일 삭제 ───────────────────────────────────────
    // project_files 행 삭제 + Storage 이미지이면 버킷에서도 제거
    async deleteFile(projectName, filePath) {
        const user = await this.getUser();
        if (!user) return;

        // storage_path 확인
        const { data: row } = await _supabase
            .from('project_files')
            .select('storage_path')
            .eq('user_id',      user.id)
            .eq('project_name', projectName)
            .eq('file_path',    filePath)
            .maybeSingle();

        if (row?.storage_path) {
            const { error: stErr } = await _supabase.storage
                .from('mod-images')
                .remove([row.storage_path]);
            if (stErr) console.error('Storage 파일 삭제 오류:', stErr.message);
        }

        const { error } = await _supabase
            .from('project_files')
            .delete()
            .eq('user_id',      user.id)
            .eq('project_name', projectName)
            .eq('file_path',    filePath);

        if (error) console.error('project_files 행 삭제 오류:', error.message);
        else       console.log(`[클라우드] 파일 삭제 완료: ${filePath}`);
    },

    // ── 프로젝트 삭제 ────────────────────────────────────────
    async deleteProject(projectName) {
        const user = await this.getUser();
        if (!user) return;

        // 1. Storage 이미지 삭제
        const { data: imgRows } = await _supabase
            .from('project_files')
            .select('storage_path')
            .eq('user_id', user.id)
            .eq('project_name', projectName)
            .not('storage_path', 'is', null);

        if (imgRows?.length) {
            const paths = imgRows.map(r => r.storage_path);
            const { error: stErr } = await _supabase.storage.from('mod-images').remove(paths);
            if (stErr) console.error('Storage 삭제 오류:', stErr.message);
        }

        // 2. project_files 행 전체 삭제
        await _supabase.from('project_files')
            .delete()
            .eq('user_id', user.id)
            .eq('project_name', projectName);

        // 3. projects 메타 행 삭제
        await _supabase.from('projects')
            .delete()
            .eq('user_id', user.id)
            .eq('name', projectName);

        console.log(`[클라우드] "${projectName}" 삭제 완료`);
    },

    // ── 단일 파일 저장 ────────────────────────────────────────
    // Ctrl+S / 편집기 저장 버튼에서 호출 — 해당 파일 1행만 upsert
    // targetUserId: 공유 프로젝트 편집자가 소유자 파일을 덮어쓸 때 소유자 ID 전달
    async saveOneFile(projectName, filePath, fd, targetUserId = null) {
        const user = await this.getUser();
        if (!user) throw new Error('로그인이 필요합니다.');
        const ownerId = targetUserId || user.id;

        const isImage = fd.type === 'dds' || fd.type === 'image';

        if (isImage) {
            // 이미지: Storage upsert
            const ext      = filePath.split('.').pop();
            let finalBase64 = fd.base64;
            try {
                const { base64: pngB64 } = await compressImageToPng(fd.base64, ext);
                if (pngB64) finalBase64 = pngB64;
            } catch(e) { /* PNG 변환 실패 시 원본 사용 */ }

            const storagePath = `${ownerId}/${projectName}/${filePath}`;
            const bytes = Uint8Array.from(atob(finalBase64), c => c.charCodeAt(0));
            const { error: upErr } = await _supabase.storage
                .from('mod-images')
                .upload(storagePath, bytes, { upsert: true, contentType: 'image/png' });
            if (upErr) throw upErr;

            const { error } = await _supabase.from('project_files').upsert({
                user_id: ownerId, project_name: projectName,
                file_path: filePath, file_type: fd.type,
                content: null, storage_path: storagePath,
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id,project_name,file_path' });
            if (error) throw error;
        } else {
            // 텍스트: content upsert
            let content = null;
            if (fd.type === 'national_focus')    content = buildFocusTxt(fd);
            else if (fd.type === 'localisation') content = buildLocYml(fd);
            else if (fd.type === 'gfx_define')   content = buildGfxFile(fd);
            else if (fd.type === 'ideas')        content = buildIdeasTxt(fd);
            else if (fd.type === 'decisions')    content = buildDecisionsTxt(fd);
            else if (fd.type === 'decisions_category') content = buildDecisionCategoriesTxt(fd);
            else if (fd.raw != null)             content = fd.raw;
            else                                 content = JSON.stringify(fd);

            const { error } = await _supabase.from('project_files').upsert({
                user_id: ownerId, project_name: projectName,
                file_path: filePath, file_type: fd.type,
                content, storage_path: null,
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id,project_name,file_path' });
            if (error) throw error;
        }

        await this._saveProjectMeta(ownerId, projectName);
        console.log(`[클라우드] 파일 저장: ${filePath}`);
    }
};

// ── Storage 재귀 목록 조회 ────────────────────────────────
// Supabase storage.list()는 한 단계만 반환하므로
// 폴더 항목(id===null)을 만나면 재귀 호출로 전체 파일 목록 수집
// 반환: storagePath 문자열 배열 ["userId/proj/gfx/foo.dds", ...]
async function _listStorageRecursive(bucket, prefix) {
    const { data, error } = await _supabase.storage
        .from(bucket)
        .list(prefix, { limit: 1000 });
    if (error || !data) {
        if (error) console.warn(`[Storage list] ${prefix} 오류:`, error.message);
        return [];
    }

    const results = [];
    for (const item of data) {
        // 빈 이름 또는 공백만 있는 항목 스킵
        if (!item.name?.trim()) continue;

        const fullPath = `${prefix}/${item.name}`;

        // 폴더 판별: id === null 또는 metadata === null (Supabase 버전별 차이)
        const isFolder = item.id === null || item.metadata === null;

        if (isFolder) {
            const sub = await _listStorageRecursive(bucket, fullPath);
            results.push(...sub);
        } else {
            results.push(fullPath);
        }
    }
    console.log(`[Storage list] ${prefix} → ${results.length}개`);
    return results;
}

// ── Blob → base64 헬퍼 ──────────────────────────────────────
function _blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

// ── 로그인 상태 표시 ────────────────────────────────────────
function _updateAuthStatus(user) {
    const statusEl = document.getElementById('auth-status-text');
    const btnOpen  = document.getElementById('btn-open-auth');
    if (!statusEl) return;
    if (user) {
        statusEl.textContent = user.email;
        if (btnOpen) btnOpen.textContent = '로그아웃';
    } else {
        statusEl.textContent = '로그인되지 않음';
        if (btnOpen) btnOpen.textContent = '로그인';
    }
}

// ── 모달 열기 / 닫기 헬퍼 ──────────────────────────────────
function _openModal() {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.style.display = 'flex';
}
function _closeModal() {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.style.display = 'none';
}

// ── UI 이벤트 연결 ──────────────────────────────────────────
function setupAuthUI() {
    const modal = document.getElementById('auth-modal');
    if (!modal) return;

    const title      = document.getElementById('auth-title');
    const executeBtn = document.getElementById('btn-auth-execute');
    const switchBtn  = document.getElementById('auth-switch');
    const closeBtn   = document.getElementById('btn-auth-close');
    const openBtn    = document.getElementById('btn-open-auth');

    // 로그인 버튼 / 로그아웃 분기
    openBtn?.addEventListener('click', async () => {
        const user = await CloudAuth.getUser();
        if (user) {
            if (confirm(`${user.email} 에서 로그아웃하시겠습니까?`)) {
                await CloudAuth.logout();
                renderRecentList();  // 홈 목록 갱신
            }
        } else {
            isSignUpMode = false;
            if (title)      title.textContent     = '서버 로그인';
            if (executeBtn) executeBtn.textContent = '로그인';
            if (switchBtn)  switchBtn.textContent  = '계정이 없으신가요? 회원가입';
            _openModal();
        }
    });

    closeBtn?.addEventListener('click', _closeModal);
    modal.addEventListener('click', e => { if (e.target === modal) _closeModal(); });

    // 로그인 ↔ 회원가입 전환
    switchBtn?.addEventListener('click', () => {
        isSignUpMode = !isSignUpMode;
        if (title)      title.textContent     = isSignUpMode ? '서버 계정 생성' : '서버 로그인';
        if (executeBtn) executeBtn.textContent = isSignUpMode ? '가입하기'       : '로그인';
        if (switchBtn)  switchBtn.textContent  = isSignUpMode
            ? '이미 계정이 있나요? 로그인'
            : '계정이 없으신가요? 회원가입';
    });

    // 실행 (로그인 / 회원가입)
    executeBtn?.addEventListener('click', async () => {
        const email = document.getElementById('auth-email')?.value?.trim();
        const pw    = document.getElementById('auth-password')?.value;
        if (!email || !pw) { alert('이메일과 비밀번호를 입력해주세요.'); return; }

        executeBtn.disabled    = true;
        executeBtn.textContent = '처리 중...';

        try {
            const { data, error } = isSignUpMode
                ? await CloudAuth.signUp(email, pw)
                : await CloudAuth.login(email, pw);

            if (error) throw error;

            if (isSignUpMode) {
                if (data?.session) {
                    _updateAuthStatus(data.session.user);
                    alert('회원가입 및 로그인 완료!');
                    _closeModal();
                    renderRecentList();
                } else {
                    alert('가입 신청 완료!\nSupabase 대시보드에서 이메일 인증을 비활성화하면 바로 로그인할 수 있습니다.');
                }
            } else {
                _updateAuthStatus(data.user);
                alert('로그인 완료! 서버 동기화가 활성화됩니다.');
                _closeModal();
                renderRecentList();  // 클라우드 프로젝트 목록 즉시 갱신
            }
        } catch (err) {
            if (err.message?.includes('Email not confirmed')) {
                alert(
                    '이메일 인증이 필요합니다.\n\n해결 방법:\n' +
                    '① Supabase 대시보드 → Authentication → Providers → Email → "Confirm email" 비활성화\n' +
                    '② 또는 가입 시 받은 인증 메일에서 링크 클릭 후 다시 로그인'
                );
            } else {
                alert('인증 오류: ' + err.message);
            }
        } finally {
            executeBtn.disabled    = false;
            executeBtn.textContent = isSignUpMode ? '가입하기' : '로그인';
        }
    });

    // 페이지 로드 시 현재 로그인 상태 반영
    CloudAuth.getUser().then(user => _updateAuthStatus(user));
}