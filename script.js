const API_KEY = {
    apiKey: "AIzaSyByGjsbzMNtt5oP4-WQdP3GQYj17kCZZTg",
    authDomain: "web-chat-project-5add6.firebaseapp.com",
    projectId: "web-chat-project-5add6",
    storageBucket: "web-chat-project-5add6.firebasestorage.app",
    messagingSenderId: "717726064112",
    appId: "1:717726064112:web:041d2112ada17ef9359135",
    measurementId: "G-708GHVNSWG"
};

const app = firebase.initializeApp(API_KEY);
const db = firebase.firestore(app);
const auth = firebase.auth(app);

let currentChannelId = null;
let invitedMembers = [];
let messageUnsubscribe = null;
let membersUnsubscribe = null;
let channelsUnsubscribe = null;
let isSending = false;
let isCreatingChannel = false;

// 테마 토글
const btn = document.getElementById("theme-toggle");
btn.addEventListener("click", () => {
    document.body.classList.toggle("dark");
    btn.textContent = document.body.classList.contains("dark") ? "☀️" : "🌙";
});

// 입력 필드 활성/비활성 제어
function toggleInputs(disabled) {
    const inputBOX = document.getElementById("userInput");
    const sendBOX = document.getElementById("send-btn");
    if (inputBOX) inputBOX.disabled = disabled;
    if (sendBOX) sendBOX.disabled = disabled;
}

// 채널 선택 함수
async function selectChannel(id, name) {
    if (currentChannelId === id && document.querySelectorAll('#user-list li').length > 0) return;
    
    currentChannelId = id;
    const headerTitle = document.getElementById('channel-title');
    if (headerTitle) headerTitle.textContent = `# ${name}`;

    // 리스너 초기화
    if (membersUnsubscribe) membersUnsubscribe();
    if (messageUnsubscribe) messageUnsubscribe();
    
    document.getElementById('outputArea').innerHTML = '';
    const userListUl = document.getElementById('user-list');
    if (userListUl) userListUl.innerHTML = '';
    
    toggleInputs(false);

    // 채널 강조 UI
    document.querySelectorAll('#channel_list li').forEach(item => {
        item.classList.toggle('selected', item.getAttribute('data-channel-id') === id);
    });

    const channelRef = db.collection('channels').doc(id);

    // 1. 멤버 목록 리스너
    membersUnsubscribe = channelRef.onSnapshot(async (doc) => {
        if (!doc.exists) return;
        const memberUids = doc.data().members || [];
        try {
            const memberNamePromises = memberUids.map(uid => 
                db.collection('users').doc(uid).get().then(uDoc => 
                    uDoc.exists ? (uDoc.data().displayName || uDoc.data().email) : "Unknown User"
                )
            );
            const memberNames = await Promise.all(memberNamePromises);
            if (userListUl) {
                userListUl.innerHTML = memberNames.map(name => `
                    <li><span class="avatar gray"></span>${name}</li>
                `).join('');
            }
        } catch (error) { console.error("멤버 로드 실패:", error); }
    });

    // 2. 메시지 리스너
    const outputArea = document.getElementById('outputArea');
    messageUnsubscribe = db.collection('messages')
        .where('channelId', '==', id)
        .orderBy('timestamp', 'asc')
        .onSnapshot(snapshot => {
            snapshot.docChanges().forEach(change => {
                const message = { id: change.doc.id, ...change.doc.data() };
                if (change.type === 'added') displayMessage(message);
                else if (change.type === 'removed') {
                    const item = outputArea.querySelector(`[data-message-id="${message.id}"]`);
                    if (item) item.remove();
                }
            });
            outputArea.scrollTop = outputArea.scrollHeight;
        });
}

// 메시지 전송
async function sendMessage() {
    if (isSending || !currentChannelId) return;
    const inputElement = document.getElementById('userInput');
    const inputText = inputElement.value.trim();
    if (!inputText) return;

    const currentUser = auth.currentUser;
    if (!currentUser) return alert("로그인이 필요합니다.");

    try {
        isSending = true;
        await db.collection('messages').add({
            channelId: currentChannelId,
            uid: currentUser.uid,
            userName: currentUser.displayName || currentUser.email,
            text: inputText,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        inputElement.value = '';
    } catch (error) {
        console.error("전송 오류:", error);
    } finally {
        isSending = false;
    }
}

// 메시지 표시
function displayMessage(message) {
    const outputArea = document.getElementById('outputArea');
    if (outputArea.querySelector(`[data-message-id="${message.id}"]`)) return;

    const currentUser = auth.currentUser;
    const isCurrentUser = (message.uid === (currentUser ? currentUser.uid : null));
    
    const container = document.createElement('div');
    container.setAttribute('data-message-id', message.id);
    container.className = `message ${isCurrentUser ? "right" : "left"}`;

    const timestamp = message.timestamp ? message.timestamp.toDate() : new Date();
    const timeStr = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let processedText = message.text || "";
    const urlRegex = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
    processedText = processedText.replace(urlRegex, url => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`);

    // displayMessage 함수 내부의 innerHTML 부분
container.innerHTML = `
    ${!isCurrentUser ? `<div class="message-meta"><span class="message-sender">${message.userName}</span></div>` : ''}
    <div class="message-content-wrapper">
        <div class="bubble">${processedText.replace(/\n/g, '<br>')}</div>
        <div class="message-info">
            <span class="message-time">${timeStr}</span>
            ${isCurrentUser ? `<button class="delete-btn" onclick="deleteMessage('${message.id}')">x</button>` : ''}
        </div>
    </div>
`;
    outputArea.appendChild(container);
    outputArea.scrollTop = outputArea.scrollHeight;
}

// 메시지 삭제
function deleteMessage(messageId) {
    if (!confirm("메시지를 삭제하시겠습니까?")) return;
    db.collection('messages').doc(messageId).delete().catch(console.error);
}

// 사용자 초대
async function inviteUserToChannel() {
    if (!currentChannelId) return alert("채널을 선택하세요.");
    const email = prompt("초대할 이메일을 입력하세요:");
    if (!email) return;

    try {
        const userSnap = await db.collection('users').where('email', '==', email.trim()).get();
        if (userSnap.empty) return alert("사용자를 찾을 수 없습니다.");

        const targetUid = userSnap.docs[0].id;
        await db.collection('channels').doc(currentChannelId).update({
            members: firebase.firestore.FieldValue.arrayUnion(targetUid)
        });
        alert("초대 완료");
    } catch (error) { console.error(error); }
}

// 채널 나가기/삭제 로직
async function leaveCurrentChannel() {
    if (!currentChannelId || !confirm("채널에서 나가시겠습니까?")) return;
    const uid = auth.currentUser.uid;
    const ref = db.collection('channels').doc(currentChannelId);

    try {
        await ref.update({ members: firebase.firestore.FieldValue.arrayRemove(uid) });
        const doc = await ref.get();
        if ((doc.data().members || []).length === 0) {
            const msgs = await db.collection('messages').where('channelId', '==', currentChannelId).get();
            const batch = db.batch();
            msgs.forEach(m => batch.delete(m.ref));
            batch.delete(ref);
            await batch.commit();
        }
        location.reload(); 
    } catch (error) { console.error(error); }
}

// 1. HTML에서 버튼 가져오기
const deleteChannelBtn = document.getElementById('delete-channel-btn');

// 2. 클릭 이벤트 연결
if (deleteChannelBtn) {
    deleteChannelBtn.addEventListener('click', async () => {
        if (!currentChannelId) return alert("삭제할 채널을 선택하세요.");
        
        // 관리자 권한 확인 로직이 필요할 수 있지만, 우선 삭제 기능부터 활성화합니다.
        if (!confirm("정말로 이 채널과 모든 메시지를 영구 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.")) return;

        try {
            const batch = db.batch();
            const channelRef = db.collection('channels').doc(currentChannelId);

            // 해당 채널의 모든 메시지 가져와서 삭제 목록에 추가
            const messagesSnapshot = await db.collection('messages').where('channelId', '==', currentChannelId).get();
            messagesSnapshot.forEach(doc => {
                batch.delete(doc.ref);
            });

            // 채널 자체 삭제
            batch.delete(channelRef);

            // 한 번에 실행 (Atomic Delete)
            await batch.commit();

            alert("채널이 완전히 삭제되었습니다.");
            location.reload(); // 화면 새로고침하여 목록 갱신
        } catch (error) {
            console.error("채널 삭제 중 오류 발생:", error);
            alert("삭제 권한이 없거나 오류가 발생했습니다.");
        }
    });
}

// 인증 상태 감시 및 채널 목록 로드 (중복 제거됨)
auth.onAuthStateChanged(user => {
    if (user) {
        if (channelsUnsubscribe) channelsUnsubscribe();
        const channelList = document.getElementById('channel_list');
        
        channelsUnsubscribe = db.collection('channels')
            .where('members', 'array-contains', user.uid)
            .orderBy('createdAt', 'asc')
            .onSnapshot(snapshot => {
                channelList.innerHTML = '';
                snapshot.forEach(doc => {
                    const li = document.createElement('li');
                    li.setAttribute('data-channel-id', doc.id);
                    li.textContent = `# ${doc.data().name}`;
                    li.onclick = () => selectChannel(doc.id, doc.data().name);
                    channelList.appendChild(li);
                });
            });
    }
});

// 초기화 및 이벤트 바인딩
document.addEventListener('DOMContentLoaded', () => {
    const userInput = document.getElementById('userInput');
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsMenu = document.getElementById('settingsMenu');

    if (userInput) {
        userInput.addEventListener('keypress', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }

    if (settingsBtn) {
        settingsBtn.addEventListener('click', e => {
            settingsMenu.classList.toggle('active');
            e.stopPropagation();
        });
    }

    document.addEventListener('click', () => settingsMenu?.classList.remove('active'));

    document.getElementById('invite-channel-btn')?.addEventListener('click', inviteUserToChannel);
    document.getElementById('exit-channel-btn')?.addEventListener('click', leaveCurrentChannel);

    // 채널 생성 모달 로직
    const channelModal = document.getElementById('channel-modal');
    const inviteEmailInput = document.getElementById('invite-email-input');
    const invitedUsersContainer = document.getElementById('invited-users-list');

    document.getElementById('create-channel-btn')?.addEventListener('click', () => {
        invitedMembers = [];
        invitedUsersContainer.innerHTML = '';
        channelModal.style.display = 'flex';
    });

    document.getElementById('check-email-btn')?.addEventListener('click', async () => {
        const email = inviteEmailInput.value.trim();
        if (!email) return;
        const snap = await db.collection('users').where('email', '==', email).get();
        if (snap.empty) return alert("가입되지 않은 이메일입니다.");
        
        const userData = snap.docs[0].data();
        const newUser = { uid: snap.docs[0].id, name: userData.displayName || email };
        if (!invitedMembers.find(m => m.uid === newUser.uid)) {
            invitedMembers.push(newUser);
            const tag = document.createElement('span');
            tag.className = 'invited-tag';
            tag.textContent = newUser.name;
            invitedUsersContainer.appendChild(tag);
        }
        inviteEmailInput.value = '';
    });

    document.getElementById('save-channel-btn')?.addEventListener('click', async () => {
        const name = document.getElementById('channel-name-input').value.trim();
        if (!name || isCreatingChannel) return;
        
        try {
            isCreatingChannel = true;
            const uids = Array.from(new Set([...invitedMembers.map(m => m.uid), auth.currentUser.uid]));
            await db.collection('channels').add({
                name: name,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                members: uids
            });
            channelModal.style.display = 'none';
        } catch (e) { console.error(e); }
        finally { isCreatingChannel = false; }
    });

    document.getElementById('cancel-channel-btn')?.addEventListener('click', () => {
        channelModal.style.display = 'none';
    });
});


