const API_KEY = import.meta.env.MY_KEYS.split(',');

const app = firebase.initializeApp(API_KEY);
const db = firebase.firestore(app);
const auth = firebase.auth(app);
const btn = document.getElementById("theme-toggle");

btn.addEventListener("click", () => {
    document.body.classList.toggle("dark");

    // 버튼 텍스트/아이콘 변경
    if (document.body.classList.contains("dark")) {
        btn.textContent = "☀️";
    } else {
        btn.textContent = "🌙";
    }
});

// 현재 선택된 채널의 ID를 저장할 전역 변수
let currentChannelId = null;

// 임시로 초대된 사용자 정보를 저장할 배열
let invitedMembers = [];

// 이전에 등록된 메시지 리스너를 저장할 전역 변수
let messageUnsubscribe = null;
let membersUnsubscribe = null;

// 
async function inviteUserToChannel() {
    if (!currentChannelId) {
        alert("채널을 선택해야 이용자를 초대할 수 있습니다.");
        return;
    }
    
    // 1. 사용자에게 초대할 이용자의 이메일 주소를 입력받습니다.
    const invitedUserEmail = prompt("초대할 이용자의 Gmail 또는 등록된 이메일을 입력하세요:");

    if (!invitedUserEmail || invitedUserEmail.trim() === '') {
        alert("이메일을 입력해야 합니다. 초대를 취소합니다.");
        return;
    }
    
    const currentUser = firebase.auth().currentUser;
    const currentUid = currentUser.uid;
    
    // 2. 자기 자신을 초대하는 경우를 방지합니다.
    if (invitedUserEmail === currentUser.email) {
        alert("자기 자신은 이미 채널에 있습니다.");
        return;
    }

    try {
        // 3. Firestore 'users' 컬렉션에서 해당 이메일로 사용자 검색
        // 이메일이 정확히 일치하는 문서를 찾습니다.
        const userQuerySnapshot = await db.collection('users')
            .where('email', '==', invitedUserEmail)
            .limit(1)
            .get();

        if (userQuerySnapshot.empty) {
            alert(`"${invitedUserEmail}" 주소로 가입된 사용자를 찾을 수 없습니다. (유효한 이메일로 가입된 사용자만 초대 가능합니다.)`);
            return;
        }

        // 4. UID 추출 및 현재 채널 멤버 확인
        const invitedUserDoc = userQuerySnapshot.docs[0];
        const invitedUserUID = invitedUserDoc.id; // user 문서의 ID = UID
        const invitedUserName = invitedUserDoc.data().displayName || invitedUserEmail;

        const channelRef = db.collection('channels').doc(currentChannelId);
        
        // 현재 채널 정보 가져오기 (이미 초대되었는지 확인하기 위함)
        const channelDoc = await channelRef.get();
        const currentMembers = channelDoc.data().members || [];

        if (currentMembers.includes(invitedUserUID)) {
            alert(`${invitedUserName}님은 이미 이 채널의 멤버입니다.`);
            return;
        }
        
        // 5. Firestore FieldValue.arrayUnion을 사용하여 중복 없이 members 배열에 UID를 추가합니다.
        await channelRef.update({
            members: firebase.firestore.FieldValue.arrayUnion(invitedUserUID)
        });

        alert(`이용자 ${invitedUserName} (${invitedUserEmail})를 채널에 성공적으로 초대했습니다.`);
        
        // 6. 채널 목록과 유저 목록이 자동으로 업데이트되도록 UI 관련 함수 호출 (필요한 경우)
        // 채널 멤버 목록 UI를 새로 고치기 위해 selectChannel을 다시 호출하거나, 
        // Firestore 리스너가 채널 문서의 'members' 배열 변화를 감지하여 처리하도록 구현되었다면 이 부분은 생략 가능합니다.
        // selectChannel(currentChannelId, document.getElementById('channel-title').textContent.replace('# ', '')); 

    } catch (error) {
        console.error("이용자 초대 오류:", error);
        alert("이용자 초대 중 오류가 발생했습니다. 콘솔을 확인하세요.");
    }
}

async function leaveCurrentChannel() {
    if (!currentChannelId) {
        alert("먼저 채널을 선택해주세요.");
        return;
    }

    const currentUid = firebase.auth().currentUser.uid;
    const channelName = document.getElementById('channel-title').textContent.replace('# ', '');

    if (!confirm(`채널 [${channelName}]에서 나가시겠습니까?`)) {
        return;
    }
    
    try {
        const channelRef = db.collection('channels').doc(currentChannelId);
        
        // 1. 현재 이용자를 members 배열에서 제거
        // Firestore FieldValue.arrayRemove을 사용하여 배열에서 현재 이용자의 UID를 제거합니다.
        await channelRef.update({
            members: firebase.firestore.FieldValue.arrayRemove(currentUid)
        });

        alert(`채널 [${channelName}]에서 성공적으로 나갔습니다.`);
        
        // 2. 채널 문서 다시 가져와서 남은 멤버 수 확인
        const channelDoc = await channelRef.get();
        const remainingMembers = channelDoc.data().members || []; // members 필드가 없을 경우 대비
        
        // 3. 남은 멤버가 0명인지 확인하고, 0명이라면 채널과 메시지 삭제 (이전 요청의 연쇄 삭제 로직 활용)
        if (remainingMembers.length === 0) {
            console.log("남은 멤버가 없어 채널과 모든 메시지를 삭제합니다.");
            
            // a. 해당 채널의 모든 메시지 삭제
            const messagesSnapshot = await db.collection('messages')
                .where('channelId', '==', currentChannelId)
                .get();

            if (!messagesSnapshot.empty) {
                const batch = db.batch();
                messagesSnapshot.docs.forEach(doc => {
                    batch.delete(doc.ref);
                });
                await batch.commit();
                console.log(`성공적으로 ${messagesSnapshot.size}개의 메시지를 삭제했습니다.`);
            }
            
            // b. 채널 문서 삭제
            await channelRef.delete();
            console.log(`남은 멤버가 없어 채널 "${channelName}" 삭제 완료.`);
        }
        
        // 4. UI 상태 초기화
        document.getElementById('channel-title').textContent = '채널을 선택하거나 생성하세요';
        document.getElementById('outputArea').innerHTML = '';
        currentChannelId = null;
        
        // 채널을 나갔으므로 입력 필드 및 컨트롤 버튼 비활성화
        disableInputs(); 
        
        // 유저 목록 초기화
        const userListUl = document.getElementById('user-list');
        if (userListUl) {
            userListUl.innerHTML = ''; 
        }

    } catch (error) {
        console.error("채널 나가기 오류:", error);
        alert("채널에서 나가는 중 오류가 발생했습니다. 콘솔을 확인하세요.");
    }
}


// 💡 텍스트 메시지만 전송하는 통합 함수 (사진 관련 로직 제거됨)
async function sendMessage() {
    // 1. 현재 채널 ID 확인
    if (!currentChannelId) {
        alert("채널을 선택해야 메시지를 보낼 수 있습니다.");
        return;
    }

    const inputElement = document.getElementById('userInput');
    // const previewArea = document.getElementById('preview'); // 제거됨

    const inputText = inputElement.value.trim();
    
    // 2. 전송 조건 확인 (순수 텍스트만 검사)
    if (inputText === "") {
        return; 
    }

    const currentUser = firebase.auth().currentUser;
    if (!currentUser) {
        alert("로그인해야 메시지를 보낼 수 있습니다.");
        return;
    }

    try {
        // 메시지 데이터 객체 생성
        const messageData = {
            channelId: currentChannelId, // ⭐ 현재 채널 ID 저장
            uid: currentUser.uid,
            userName: currentUser.displayName || currentUser.email || '익명 사용자',
            text: inputText,
            // imageUrl, fileUrl 필드 제거됨
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };

        // 3. Firestore 'messages' 컬렉션에 메시지 저장
        await db.collection('messages').add(messageData);
        
        // 4. 입력 필드 초기화
        inputElement.value = '';
        // clearImagePreview(); // 제거됨
        
    } catch (error) {
        console.error("메시지 전송 중 오류 발생:", error);
        alert("메시지 전송에 실패했습니다.");
    }
}


// 💡 입력 필드를 비활성화하는 함수 (imageFile/fileUpload는 DOM에서 제거되거나 비활성화되어야 함)
function disableInputs() {
    const inputBOX = document.getElementById("userInput");
    // const imageBOX = document.getElementById("imageFile"); // 제거됨
    // const fileBOX = document.getElementById("fileUpload"); // 제거됨
    const sendBOX = document.getElementById("send-btn");
    
    if (inputBOX) { inputBOX.disabled = true; }
    // if (imageBOX) { imageBOX.disabled = true; }
    // if (fileBOX) { fileBOX.disabled = true; }
    if (sendBOX) { sendBOX.disabled = true; }
}


// 채널 선택 시 호출되는 함수
async function selectChannel(id, name) {
    // 1. 현재 채널 ID 업데이트
    currentChannelId = id;
    
    // 2. UI 업데이트: 제목 변경 및 선택 강조
    const headerTitle = document.getElementById('channel-title');
    if (headerTitle) {
        headerTitle.textContent = `# ${name}`; 
    }
    
    // 3. UI 업데이트: 채널 목록에서 선택된 항목 강조
    const channelList = document.getElementById('channel_list');
    
    // 기존에 선택된 항목의 강조 해제
    channelList.querySelectorAll('li').forEach(item => {
        item.classList.remove('selected');
    });
    
    // 새로 선택된 항목 강조
    const selectedItem = channelList.querySelector(`[data-channel-id="${id}"]`);
    if (selectedItem) {
        selectedItem.classList.add('selected');
    }

    // 3. 메시지 영역 및 유저 목록 초기화
    document.getElementById('outputArea').innerHTML = ''; 
    const userListUl = document.getElementById('user-list');
    if (userListUl) {
        userListUl.innerHTML = ''; 
    }

    const inputBOX = document.getElementById("userInput");
    const sendBOX = document.getElementById("send-btn");
    
    // 4. disabled 프로퍼티를 false로 설정하여 입력/전송 필드를 활성화합니다.
    if (inputBOX) { inputBOX.disabled = false; }
    if (sendBOX) { sendBOX.disabled = false; }
    
    // 4. ⭐ 기존 멤버 리스너 해제 및 새 리스너 설정 (핵심 수정 부분)
    if (membersUnsubscribe) {
        membersUnsubscribe(); // 이전 채널의 멤버 리스너 해제
    }

    const channelRef = db.collection('channels').doc(id);

    // 💡 새 멤버 리스너 설정: 채널 문서의 변화를 실시간 감지
    membersUnsubscribe = channelRef.onSnapshot(async (doc) => {
        if (!doc.exists) {
            console.warn("채널 문서가 존재하지 않습니다.");
            return;
        }

        const channelData = doc.data();
        const memberUids = channelData.members || [];
        
        // 5. 유저 목록 UI 초기화 후 다시 그리기
        if (userListUl) {
            userListUl.innerHTML = ''; // 기존 목록 초기화
        }

        // 모든 멤버 이름 조회 Promise 생성 (기존 로직 재사용)
        const memberNamePromises = memberUids.map(uid => {
            return db.collection('users').doc(uid).get()
                .then(doc => {
                    if (doc.exists) {
                        const userData = doc.data();
                        return userData.displayName || userData.email || `User (${uid.substring(0, 4)}...)`;
                    }
                    return `Unknown User (${uid.substring(0, 4)}...)`;
                })
                .catch(error => {
                    console.error("멤버 정보 조회 오류:", uid, error);
                    return `Error User (${uid.substring(0, 4)}...)`;
                });
        });

        // 모든 Promise가 완료될 때까지 대기
        const memberNames = await Promise.all(memberNamePromises);

        // UI에 멤버 목록 추가
        if (userListUl) {
            memberNames.forEach(member => {
                const list_name = document.createElement('li');
                list_name.innerHTML = `
                    <span class="avatar gray"></span> 
                    ${member} 
                `; 
                userListUl.appendChild(list_name);
            });
        }
    }, error => {
        console.error("채널 멤버 리스너 오류:", error);
    });

    // 6. ⭐ 기존 메시지 리스너 해제 및 새 리스너 설정
    if (messageUnsubscribe) {
        messageUnsubscribe(); // 이전 채널의 리스너 해제
    }

    const outputArea = document.getElementById('outputArea');

    // 새로운 메시지 리스너 설정: 현재 채널 ID와 일치하는 메시지만 가져옴
    messageUnsubscribe = db.collection('messages')
        .where('channelId', '==', id)
        .orderBy('timestamp', 'asc')
        .onSnapshot(snapshot => {
            // ... (기존 메시지 처리 로직은 그대로 유지) ...
            snapshot.docChanges().forEach(change => {
                const message = change.doc.data();
                
                // ⭐ 메시지 객체에 문서 ID(messageId)를 추가합니다. 
                message.id = change.doc.id; 
                
                if (change.type === 'added') {
                    displayMessage(message);
                } else if (change.type === 'removed') {
                    // ⭐ 메시지가 삭제되면 해당 DOM 요소를 제거하는 로직 추가
                    const itemToRemove = outputArea.querySelector(`[data-message-id="${change.doc.id}"]`);
                    if (itemToRemove) {
                        itemToRemove.remove();
                    }
                    return; // 제거되면 displayMessage 호출하지 않음
                }
            });

            // 메시지가 로드된 후 스크롤을 맨 아래로 이동
            outputArea.scrollTop = outputArea.scrollHeight;
        }, error => {
            console.error("메시지 로드 오류:", error);
        });
}

// 💡 메시지 데이터를 받아 채팅창에 표시하는 함수 (링크 자동 렌더링 기능 포함)
function displayMessage(message) {
    const outputArea = document.getElementById('outputArea');
    const currentUser = firebase.auth().currentUser;
    const currentUid = currentUser ? currentUser.uid : null;
    
    // 이미 존재하는 메시지는 추가하지 않음
    if (outputArea.querySelector(`[data-message-id="${message.id}"]`)) {
        return;
    }
    
    const messageContainer = document.createElement('div'); 
    
    const timestamp = message.timestamp ? message.timestamp.toDate() : new Date();
    const timeString = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    messageContainer.setAttribute('data-message-id', message.id); 

    const isCurrentUser = (message.uid === currentUid);
    messageContainer.classList.add("message", isCurrentUser ? "right" : "left");
    
    // 1. 메타데이터 컨테이너 생성 (이름)
    const metaData = document.createElement('div');
    metaData.classList.add('message-meta'); 
    
    // 2. 상대방 이름 표시 (내 메시지가 아닐 경우)
    if (!isCurrentUser) {
        const nameElement = document.createElement('span');
        nameElement.classList.add('message-sender');
        nameElement.textContent = message.userName;
        metaData.appendChild(nameElement);
    }
    
    // 메시지 버블 생성
    const bubble = document.createElement('div');
    bubble.classList.add("bubble");
    
    // 텍스트 내용 처리
    if (message.text) {
        let processedText = message.text;
        
        // ⭐⭐⭐ 핵심: URL 정규 표현식을 사용하여 링크를 <a> 태그로 자동 변환 ⭐⭐⭐
        // (다른 사용자가 보낸 링크도 클릭 가능하도록)
        // 정규식: http://, https:// 또는 ftp:// 로 시작하는 모든 유효한 URL을 감지
        const urlRegex = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
        processedText = processedText.replace(urlRegex, (url) => {
            // target="_blank"를 사용하여 새 창에서 링크가 열리도록 합니다.
            return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
        });
        
        // 줄 바꿈 문자를 <br> 태그로 변환하여 렌더링
        bubble.innerHTML = processedText.replace(/\n/g, '<br>');
    }
    
    // 3. 메시지 버블과 시간 사이를 감싸는 컨테이너 생성
    const contentWrapper = document.createElement('div');
    contentWrapper.classList.add('message-content-wrapper');

    // 4. 시간 표시
    const timeElement = document.createElement('span');
    timeElement.classList.add('message-time');
    timeElement.textContent = timeString;

    // 5. 삭제 버튼 추가 (내 메시지에만)
    if (isCurrentUser) {
        const deleteBtn = document.createElement('button');
        deleteBtn.classList.add('delete-btn');
        deleteBtn.textContent = 'x'; 
        
        deleteBtn.addEventListener('click', () => {
            deleteMessage(message.id); 
        });
        
        contentWrapper.appendChild(timeElement); 
        contentWrapper.appendChild(deleteBtn);
        contentWrapper.appendChild(bubble);

    } else {
        contentWrapper.appendChild(bubble);
        contentWrapper.appendChild(timeElement);
    }

    // 메타데이터(이름)와 메시지 컨테이너(버블, 시간, 삭제)를 최종 컨테이너에 추가
    messageContainer.appendChild(metaData);
    messageContainer.appendChild(contentWrapper);
    
    outputArea.appendChild(messageContainer);
    outputArea.scrollTop = outputArea.scrollHeight;
}

// ⭐ 메시지 삭제 함수 (메시지 작성자가 x 버튼 클릭 시 DB 삭제 보장)
function deleteMessage(messageId) {
    if (!messageId) {
        console.error("삭제할 메시지 ID가 없습니다.");
        return;
    }
    
    // 사용자에게 최종 확인 메시지 표시
    // 이 확인 과정이 취소되면 delete()가 실행되지 않습니다.
    if (!confirm("이 메시지를 영구적으로 삭제하시겠습니까? (이 작업은 되돌릴 수 없습니다.)")) {
        return;
    }

    // Firestore에서 메시지 문서 삭제
    db.collection('messages').doc(messageId).delete()
        .then(() => {
            console.log(`메시지 ID ${messageId} 삭제 완료 (DB 반영).`);
            // onSnapshot 리스너가 'removed' 이벤트를 감지하여 UI를 업데이트합니다.
        })
        .catch(error => {
            console.error("메시지 삭제 오류:", error);
            alert("메시지 삭제 중 오류가 발생했습니다.");
        });
}

// ⭐ 채널 삭제 함수 (수정됨: 메시지 연쇄 삭제 로직 추가)
async function deleteCurrentChannel() {
    if (!currentChannelId) {
        alert("삭제할 채널을 먼저 선택해주세요.");
        return;
    }

    const channelName = document.getElementById('channel-title').textContent.replace('# ', '');

    if (!confirm(`채널 [${channelName}] 을(를) 정말로 삭제하시겠습니까? (이 채널의 모든 메시지도 삭제됩니다. 이 작업은 되돌릴 수 없습니다.)`)) {
        return; // 사용자가 취소를 누르면 종료
    }
    
    // 로딩 상태 표시 (선택 사항: 사용자에게 진행 중임을 알릴 수 있음)
    console.log("메시지 및 채널 삭제 시작...");
    
    try {
        // =========================================================
        // 1. 해당 채널의 모든 메시지 삭제
        // =========================================================
        
        // 해당 channelId를 가진 모든 메시지 문서 조회
        const messagesSnapshot = await db.collection('messages')
            .where('channelId', '==', currentChannelId)
            .get();

        if (!messagesSnapshot.empty) {
            // 배치(Batch) 쓰기를 사용하여 여러 문서를 한 번에 삭제 처리 (권장)
            const batch = db.batch();
            
            messagesSnapshot.docs.forEach(doc => {
                batch.delete(doc.ref); // 배치에 삭제 연산 추가
            });

            await batch.commit(); // 배치 실행 (모든 메시지 삭제)
            console.log(`성공적으로 ${messagesSnapshot.size}개의 메시지를 삭제했습니다.`);
        } else {
            console.log("삭제할 메시지가 없습니다.");
        }

        // =========================================================
        // 2. 채널 문서 삭제
        // =========================================================
        await db.collection('channels').doc(currentChannelId).delete();
        
        console.log(`채널 "${channelName}" (ID: ${currentChannelId}) 삭제 완료.`);
        
        // UI 상태 초기화
        document.getElementById('channel-title').textContent = '채널을 선택하거나 생성하세요';
        document.getElementById('outputArea').innerHTML = ''; // 채팅 메시지 초기화
        currentChannelId = null;
        
        // 입력 필드 비활성화
        disableInputs();

        // 유저 목록 초기화
        const userListUl = document.getElementById('user-list');
        if (userListUl) {
            userListUl.innerHTML = ''; 
        }

    } catch (error) {
        console.error("채널 및 메시지 삭제 오류:", error);
        alert("채널 및 관련 메시지 삭제 중 오류가 발생했습니다.");
    }
}

// ⭐⭐ 핵심 수정: 인증 상태 변경 리스너를 사용하여 채널 목록을 필터링합니다. ⭐⭐
auth.onAuthStateChanged(user => {
    // 💡 (선택 사항: 사용자 정보 저장/업데이트 로직)
    if (user) {
        // user.uid로 users 컬렉션에 사용자 정보 저장/업데이트
        db.collection('users').doc(user.uid).set({
            email: user.email,
            displayName: user.displayName || user.email,
            // 기타 사용자 정보
        }, { merge: true }); // 기존 필드는 유지하고 업데이트
        
    }

    // ⭐ 1. 채널 목록 리스너 해제 (재설정 전에)
    // 이전에 설정된 채널 리스너를 해제하는 전역 변수가 필요할 수 있지만, 
    // 여기서는 DOMContentLoaded 내부의 리스너를 교체하는 것으로 가정합니다.
    
    const channelList = document.getElementById('channel_list');
    if (!channelList) return; // 채널 목록 DOM 요소가 없으면 종료

    // 기존 목록 초기화
    channelList.innerHTML = '';
    
    // ⭐ 2. 현재 사용자 ID를 기준으로 채널 목록을 가져오는 쿼리 실행
    if (user) {
        const currentUserId = user.uid;

        // 💡 Firestore 쿼리 수정: 'members' 배열에 현재 사용자 ID가 포함된 채널만 가져오도록 필터링
        db.collection('channels')
            .where('members', 'array-contains', currentUserId)
            .orderBy('createdAt', 'asc')
            .onSnapshot((snapshot) => {
                snapshot.docChanges().forEach((change) => {
                    const channelData = change.doc.data();
                    const channelId = change.doc.id; 

                    if (change.type === "added") {
                        // 💡 'array-contains' 필터링을 했으므로, 별도의 멤버 확인 없이 UI에 추가
                        
                        // 이미 UI에 존재하는지 확인 (중복 방지)
                        if (channelList.querySelector(`[data-channel-id="${channelId}"]`)) {
                            return;
                        }

                        // 채널 UI 항목 생성
                        const listItem = document.createElement('li');
                        listItem.setAttribute('data-channel-id', channelId);
                        listItem.textContent = `# ${channelData.name}`;

                        // <li> 요소에 클릭 이벤트 리스너 추가
                        listItem.addEventListener('click', () => {
                            selectChannel(channelId, channelData.name);
                        });
                        
                        // 채널 목록에 추가
                        channelList.appendChild(listItem);
                        
                    } else if (change.type === "removed") {
                        // ⭐ 채널이 삭제되었을 때 UI에서 제거 (다른 멤버가 채널을 삭제했거나, 본인이 나가서 채널이 삭제된 경우)
                        const itemToRemove = channelList.querySelector(`[data-channel-id="${channelId}"]`);
                        if (itemToRemove) {
                            itemToRemove.remove(); // <li> 요소 제거
                        }
                        
                        // 현재 선택된 채널이라면 상태 초기화
                        if (channelId === currentChannelId) {
                            document.getElementById('channel-title').textContent = '채널을 선택하거나 생성하세요';
                            document.getElementById('outputArea').innerHTML = '';
                            currentChannelId = null;
                            disableInputs();
                            const userListUl = document.getElementById('user-list');
                            if (userListUl) {
                                userListUl.innerHTML = ''; 
                            }
                        }
                    } else if (change.type === "modified") {
                        // ⭐ 채널 이름 등이 수정되었을 때 UI 업데이트 (이름 변경 기능이 있다면)
                        const itemToModify = channelList.querySelector(`[data-channel-id="${channelId}"]`);
                        if (itemToModify) {
                            itemToModify.textContent = `# ${channelData.name}`;
                        }
                        // 채널을 나가서 멤버 목록이 수정되었을 때도 리스너가 재실행되어 채널 목록에서 사라질 수 있습니다.
                    }
                });
            });
    }
});

document.addEventListener('DOMContentLoaded', () => {
    // 💡 사진 업로드 관련 요소 제거: fileInput, previewArea는 DOM에서 제외해야 합니다.
    // const fileInput = document.getElementById('imageFile');
    // const previewArea = document.getElementById('preview');
    const userInput = document.getElementById('userInput');
    
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsMenu = document.getElementById('settingsMenu');
    
    const deleteChannelBtn = document.getElementById('delete-channel-btn');
    const inviteChannelBtn = document.getElementById('invite-channel-btn');
    const exitChannelBtn = document.getElementById('exit-channel-btn');

    
    // 💡 삭제 버튼 이벤트 리스너 연결
    if (deleteChannelBtn) {
        deleteChannelBtn.addEventListener('click', deleteCurrentChannel);
    }

    // 💡 초대 버튼 이벤트 리스너 연결
    if (inviteChannelBtn) {
        inviteChannelBtn.addEventListener('click', inviteUserToChannel);
    }

    // 💡 나가기 버튼 이벤트 리스너 연결
    if (exitChannelBtn) {
        exitChannelBtn.addEventListener('click', leaveCurrentChannel);
    }
    
    // 💡 1. 톱니바퀴 버튼 클릭 이벤트: 메뉴 토글 
    if (settingsBtn && settingsMenu) {
        settingsBtn.addEventListener('click', (event) => {
            settingsMenu.classList.toggle('active');
            event.stopPropagation(); 
        });
    }

    // 💡 2. 빈 공간 클릭 이벤트: 메뉴 닫기
    document.addEventListener('click', (event) => {
        if (settingsMenu && settingsMenu.classList.contains('active')) {
            if (!settingsMenu.contains(event.target) && event.target !== settingsBtn) {
                settingsMenu.classList.remove('active');
            }
        }
    });

    // 💡 3. 메뉴 아이템 클릭 시 메뉴 닫기 (선택적)
    if (settingsMenu) {
        const menuItems = settingsMenu.querySelectorAll('.menu-item');
        menuItems.forEach(item => {
            item.addEventListener('click', () => {
                settingsMenu.classList.remove('active');
                console.log(`${item.textContent.trim()} 버튼이 눌렸습니다.`);
            });
        });
    }


    // 2. 파일 입력(input) 관련 로직 제거됨

    // Enter 키로 메시지 전송
    userInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) { // Shift+Enter는 줄바꿈 허용
            event.preventDefault(); 
            sendMessage(); 
        }
    });

    // ⭐ 새 채널 생성 모달을 위한 요소 가져오기
    const createChannelBtn = document.getElementById('create-channel-btn');
    const channelList = document.getElementById('channel_list');
    const channelModal = document.getElementById('channel-modal'); 
    const channelNameInput = document.getElementById('channel-name-input'); 
    const saveChannelBtn = document.getElementById('save-channel-btn'); 
    const cancelChannelBtn = document.getElementById('cancel-channel-btn'); 

    // 💡 새로 추가된 초대 관련 요소
    const inviteEmailInput = document.getElementById('invite-email-input');
    const checkEmailBtn = document.getElementById('check-email-btn');
    const inviteWarningText = document.getElementById('invite-warning-text');
    const invitedUsersContainer = document.getElementById('invited-users-list');

    // 💡 팝업 모달을 표시하는 함수 
    function showChannelModal() {
        channelNameInput.value = ''; 
        inviteEmailInput.value = ''; 
        inviteWarningText.textContent = ''; 
        invitedUsersContainer.innerHTML = ''; 
        invitedMembers = []; 
        channelModal.style.display = 'flex'; 
        channelNameInput.focus();
    }

    // 💡 팝업 모달을 숨기는 함수
    function hideChannelModal() {
        channelModal.style.display = 'none'; 
    }

    // ⭐ 새로 추가: 이메일 확인 및 초대 목록에 추가하는 함수
    function checkAndAddInvitedUser() {
        const email = inviteEmailInput.value.trim();
        inviteWarningText.textContent = ''; 

        if (email === "") {
            inviteWarningText.textContent = "이메일을 입력해주세요.";
            return;
        }

        // 현재 로그인된 사용자 확인
        const currentUser = firebase.auth().currentUser;
        if (currentUser && currentUser.email === email) {
            inviteWarningText.textContent = "자신은 자동으로 채널 멤버에 포함됩니다. 다른 사용자를 초대해주세요.";
            inviteEmailInput.value = '';
            return;
        }

        // 이미 초대된 이메일인지 확인
        if (invitedMembers.some(member => member.email === email)) {
            inviteWarningText.textContent = "이미 초대 목록에 있는 사용자입니다.";
            inviteEmailInput.value = '';
            return;
        }

        // Firestore 'users' 컬렉션에서 해당 이메일로 사용자 검색
        db.collection('users').where('email', '==', email).get()
            .then(snapshot => {
                if (snapshot.empty) {
                    // 사용자 없음 -> 경고 텍스트 표시
                    inviteWarningText.textContent = `"${email}" 주소를 가진 사용자를 찾을 수 없습니다. (유효한 이메일로 가입된 사용자만 초대 가능합니다.)`;
                } else {
                    // 사용자 찾음 (첫 번째 문서 사용)
                    const userData = snapshot.docs[0].data();
                    const userUid = snapshot.docs[0].id;
                    // name 필드가 없으면 displayName, 그것도 없으면 email 사용
                    const userName = userData.name || userData.displayName || email; 

                    // 초대 목록에 추가 (임시 배열 및 UI)
                    const newMember = { uid: userUid, name: userName, email: email };
                    invitedMembers.push(newMember);

                    // UI 업데이트 (초대된 사용자 이름 태그 표시)
                    const memberItem = document.createElement('span');
                    memberItem.classList.add('invited-tag');
                    memberItem.textContent = userName;
                    invitedUsersContainer.appendChild(memberItem);

                    inviteWarningText.textContent = `${userName}님이 초대 목록에 추가되었습니다.`;
                    inviteEmailInput.value = ''; 
                }
            })
            .catch(error => {
                console.error("사용자 검색 오류:", error);
                inviteWarningText.textContent = "사용자 검색 중 오류가 발생했습니다. (콘솔 확인)";
            });
    }

    // 💡 이메일 확인/추가 버튼 클릭 이벤트
    if (checkEmailBtn) {
        checkEmailBtn.addEventListener('click', checkAndAddInvitedUser);
    }
    
    // 💡 이메일 입력창에서 Enter 키 입력 시
    if (inviteEmailInput) {
        inviteEmailInput.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                checkEmailBtn.click();
            }
        });
    }

    // 💡 새 채널 생성 버튼 클릭 이벤트: 모달 열기
    createChannelBtn.addEventListener('click', () => {
        showChannelModal();
    });

    // 💡 취소 버튼 클릭 이벤트: 모달 닫기
    cancelChannelBtn.addEventListener('click', () => {
        hideChannelModal();
    });

    // 💡 확인 버튼 클릭 이벤트: Firestore 저장 및 모달 닫기
    saveChannelBtn.addEventListener('click', () => {
        const currentUser = firebase.auth().currentUser;
        
        if (!currentUser) {
        alert("채널을 생성하려면 먼저 로그인해야 합니다.");
        return;
        }

        const currentUserId = currentUser.uid; // 현재 로그인된 사용자의 UID

        const newChannelName = channelNameInput.value.trim();

        // 1. 채널 이름 유효성 검사
        if (newChannelName === "") {
            alert("채널 이름을 입력해주세요.");
            channelNameInput.focus();
            return;
        }
        
        // ⭐ 2. 초대 사용자 유효성 검사 (최소 1명 이상 초대 필요)
        if (invitedMembers.length === 0) {
            alert("채널을 생성하려면 최소 한 명 이상의 유효한 사용자를 초대해야 합니다.");
            inviteEmailInput.focus();
            return;
        }

        // 3. Firestore 'channels' 컬렉션에 새 문서(채널) 추가
        let memberUids = invitedMembers.map(member => member.uid);
        
        //   현재 로그인한 사용자(채널 생성자)의 UID를 memberUids에 추가합니다.
        if (!memberUids.includes(currentUserId)) {
            memberUids.push(currentUserId);
        }
    
        // 중복 제거
        memberUids = Array.from(new Set(memberUids));
        
    });
    // 💡 확인 버튼 클릭 이벤트: Firestore 저장 및 모달 닫기
saveChannelBtn.addEventListener('click', async () => { // ⭐ async 키워드 추가
    const currentUser = firebase.auth().currentUser;
    
    if (!currentUser) {
        alert("채널을 생성하려면 먼저 로그인해야 합니다.");
        return;
    }

    const currentUserId = currentUser.uid; // 현재 로그인된 사용자의 UID

    const newChannelName = channelNameInput.value.trim();

    // 1. 채널 이름 유효성 검사
    if (newChannelName === "") {
        alert("채널 이름을 입력해주세요.");
        channelNameInput.focus();
        return;
    }
    
    // 2. 초대 사용자 유효성 검사 (최소 1명 이상 초대 필요)
    // 참고: 생성자(본인)는 자동으로 추가되므로, 초대 목록이 비어있어도 됩니다.
    // 하지만 현재 로직에서는 명시적으로 초대하도록 되어 있으므로, 이 유효성 검사를 유지합니다.
    if (invitedMembers.length === 0) {
        alert("채널을 생성하려면 최소 한 명 이상의 유효한 사용자를 초대해야 합니다.");
        inviteEmailInput.focus();
        return;
    }

    // 3. Firestore 'channels' 컬렉션에 새 문서(채널) 추가
    let memberUids = invitedMembers.map(member => member.uid);
    
    // 현재 로그인한 사용자(채널 생성자)의 UID를 memberUids에 추가합니다.
    if (!memberUids.includes(currentUserId)) {
        memberUids.push(currentUserId);
    }

    // 중복 제거
    memberUids = Array.from(new Set(memberUids));
    
    // ⭐⭐⭐ 핵심 수정: Firestore에 데이터 저장 ⭐⭐⭐
    try {
        await db.collection('channels').add({
            name: newChannelName,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            createdBy: currentUserId,
            members: memberUids // 초대된 사용자 + 생성자 UID
        });

        // 4. 성공 알림 및 모달 닫기
        alert(`채널 #${newChannelName}이(가) 성공적으로 생성되었습니다.`);
        hideChannelModal(); // 모달 닫기

        // 채널이 생성되면 auth.onAuthStateChanged 내부의 리스너가 이를 감지하여
        // 자동으로 좌측 목록에 채널을 추가하고, 선택하도록 할 수 있습니다.

    } catch (error) {
        console.error("채널 생성 중 오류 발생:", error);
        alert("채널 생성에 실패했습니다. (콘솔 확인)");
    }
});


});


