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
const auth = firebase.auth(app);
const db = firebase.firestore(app);


//사용자 정보를 Firestore의 'users' 컬렉션에 저장
        async function saveUserToFirestore(user) {
    
            const userRef = db.collection("users").doc(user.uid); 
            
            const userData = {
                uid: user.uid,
                displayName: user.displayName,
                email: user.email,
                photoURL: user.photoURL,
                lastLogin: new Date().toISOString(),
                createdAt: user.metadata.creationTime,
            };

            try {
                // merge: true 옵션으로 기존 필드를 유지하며 업데이트
                await userRef.set(userData, { merge: true }); 
                console.log("Firestore에 사용자 정보 저장 완료:", user.uid);
            } catch (e) {
                console.error("Firestore에 사용자 정보 저장 중 오류 발생: ", e);
            }
        }

        //로그인 성공 후 지정된 페이지로 이동합니다.
        function redirectToNextPage() {
            window.location.href = "chat_main.html"; 
        }

        // Google 계정으로 로그인 및 후속 작업을 처리합니다.
        async function signInWithGoogleAndSave() {
            // GoogleAuthProvider는 firebase.auth.GoogleAuthProvider를 통해 접근
            const provider = new firebase.auth.GoogleAuthProvider(); 

            try {
                // signInWithPopup은 auth 인스턴스를 통해 호출
                const result = await auth.signInWithPopup(provider); 
                const user = result.user;
                console.log("Google 로그인 성공. 사용자:", user.displayName);

                await saveUserToFirestore(user);

                redirectToNextPage();

            } catch (error) {
                const errorCode = error.code;
                const errorMessage = error.message;

                if (errorCode !== 'auth/popup-closed-by-user') {
                   console.error("Google 로그인 중 오류 발생:", errorCode, errorMessage);
                   alert(`로그인 오류: ${errorMessage}`);
                }
            }
        }

        // HTML 문서가 완전히 로드된 후 이벤트 리스너 연결
        document.addEventListener('DOMContentLoaded', () => {
            const signInButton = document.getElementById('google-sign-in-button');
            
            if (signInButton) {
                // 버튼 클릭 시 로그인 함수 실행
                signInButton.addEventListener('click', signInWithGoogleAndSave);
            }
        });
