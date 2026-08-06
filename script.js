/* ========================================= */
/* PT. JUARA Mail - Portal Email Perusahaan */
/* Main JavaScript File */
/* ========================================= */

// Menunggu DOM selesai dimuat sebelum menjalankan script
document.addEventListener('DOMContentLoaded', function() {
    
    /* ========================================= */
    /* INISIALISASI SEMUA FUNGSI */
    /* ========================================= */
    initLoadingScreen();
    initFadeInAnimation();
    initRippleEffect();
    initCurrentYear();
    initMailRain();
    
});

/* ========================================= */
/* MAIL RAIN BACKGROUND ANIMATION */
/* ========================================= */

/**
 * Membuat efek "hujan" ikon amplop yang jatuh perlahan
 * di background halaman sebagai dekorasi
 */
function initMailRain() {
    const container = document.getElementById('mailRain');
    if (!container) return;

    const ICON_COUNT = 16;
    const mailSvg = `
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="2.5" y="5" width="19" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
            <path d="M3.5 6.5L12 13L20.5 6.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `;

    for (let i = 0; i < ICON_COUNT; i++) {
        const icon = document.createElement('div');
        icon.className = 'mail-rain-icon';
        icon.innerHTML = mailSvg;

        // Randomisasi posisi, ukuran, kecepatan, dan delay agar terasa natural
        const size = Math.random() * 16 + 14; // 14px - 30px
        const left = Math.random() * 100; // 0% - 100%
        const duration = Math.random() * 10 + 10; // 10s - 20s
        const delay = Math.random() * -20; // mulai di posisi acak dalam siklus
        const opacity = Math.random() * 0.3 + 0.15; // 0.15 - 0.45

        icon.style.width = size + 'px';
        icon.style.height = size + 'px';
        icon.style.left = left + '%';
        icon.style.animationDuration = duration + 's';
        icon.style.animationDelay = delay + 's';
        icon.style.setProperty('--mail-opacity', opacity);

        container.appendChild(icon);
    }
}

/* ========================================= */
/* LOADING SCREEN */
/* ========================================= */

/**
 * Menampilkan loading screen saat halaman dibuka
 * dan menyembunyikannya setelah beberapa detik
 */
function initLoadingScreen() {
    const loadingScreen = document.getElementById('loadingScreen');
    
    if (loadingScreen) {
        // Simulasi loading selama 1.5 detik
        setTimeout(() => {
            // Tambahkan class 'hidden' untuk animasi fade out
            loadingScreen.classList.add('hidden');
            
            // Setelah animasi selesai, hapus loading screen dari DOM
            setTimeout(() => {
                loadingScreen.style.display = 'none';
                
                // Trigger animasi fade-in untuk elemen utama
                triggerFadeIn();
            }, 600);
        }, 1500);
    }
}

/* ========================================= */
/* FADE-IN ANIMATION */
/* ========================================= */

/**
 * Menginisialisasi animasi fade-in untuk elemen
 * saat halaman dimuat
 */
function initFadeInAnimation() {
    // Animasi akan dijalankan setelah loading screen hilang
}

/**
 * Trigger animasi fade-in untuk semua elemen dengan class fade-in
 */
function triggerFadeIn() {
    const fadeElements = document.querySelectorAll('.fade-in');
    
    fadeElements.forEach((element) => {
        // Ambil delay dari data attribute
        const delay = element.getAttribute('data-delay') || 0;
        
        setTimeout(() => {
            element.classList.add('visible');
        }, parseInt(delay));
    });
}

/* ========================================= */
/* RIPPLE EFFECT UNTUK BUTTON */
/* ========================================= */

/**
 * Menambahkan efek ripple (gelombang) saat button diklik
 * Seperti Material Design
 */
function initRippleEffect() {
    const buttons = document.querySelectorAll('.btn-login, .quick-card');
    
    buttons.forEach(button => {
        button.addEventListener('click', function(e) {
            // Buat elemen ripple
            const ripple = document.createElement('span');
            ripple.classList.add('ripple');
            
            // Dapatkan posisi klik relatif terhadap button
            const rect = this.getBoundingClientRect();
            const size = Math.max(rect.width, rect.height);
            const x = e.clientX - rect.left - size / 2;
            const y = e.clientY - rect.top - size / 2;
            
            // Set posisi dan ukuran ripple
            ripple.style.width = ripple.style.height = size + 'px';
            ripple.style.left = x + 'px';
            ripple.style.top = y + 'px';
            
            // Tambahkan ripple ke button
            this.appendChild(ripple);
            
            // Hapus ripple setelah animasi selesai
            setTimeout(() => {
                ripple.remove();
            }, 600);
        });
    });
}

/* ========================================= */
/* NOTIFICATION SYSTEM */
/* ========================================= */

/**
 * Menampilkan notifikasi pop-up modern
 * @param {string} message - Pesan notifikasi
 * @param {string} type - Tipe notifikasi (info, warning, success, error)
 */
function showNotification(message, type = 'info') {
    // Hapus notifikasi yang sudah ada (jika ada)
    const existingNotification = document.querySelector('.custom-notification');
    if (existingNotification) {
        existingNotification.remove();
    }
    
    // Buat elemen notifikasi
    const notification = document.createElement('div');
    notification.className = `custom-notification notification-${type}`;
    
    // Pilih icon berdasarkan tipe
    let iconSvg = '';
    switch(type) {
        case 'success':
            iconSvg = `
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22 11.08V12a10 10 0 11-5.93-9.14" stroke="#2F6FEE" stroke-width="2" stroke-linecap="round"/>
                    <polyline points="22,4 12,14.01 9,11.01" stroke="#2F6FEE" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            `;
            break;
        case 'warning':
            iconSvg = `
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" 
                          stroke="#2F6FEE" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    <line x1="12" y1="9" x2="12" y2="13" stroke="#2F6FEE" stroke-width="2" stroke-linecap="round"/>
                    <line x1="12" y1="17" x2="12.01" y2="17" stroke="#2F6FEE" stroke-width="2" stroke-linecap="round"/>
                </svg>
            `;
            break;
        case 'error':
            iconSvg = `
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="12" cy="12" r="10" stroke="#E5484D" stroke-width="2"/>
                    <line x1="15" y1="9" x2="9" y2="15" stroke="#E5484D" stroke-width="2" stroke-linecap="round"/>
                    <line x1="9" y1="9" x2="15" y2="15" stroke="#E5484D" stroke-width="2" stroke-linecap="round"/>
                </svg>
            `;
            break;
        default:
            iconSvg = `
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="12" cy="12" r="10" stroke="#2F6FEE" stroke-width="2"/>
                    <line x1="12" y1="16" x2="12" y2="12" stroke="#2F6FEE" stroke-width="2" stroke-linecap="round"/>
                    <line x1="12" y1="8" x2="12.01" y2="8" stroke="#2F6FEE" stroke-width="2" stroke-linecap="round"/>
                </svg>
            `;
    }
    
    notification.innerHTML = `
        <div class="notification-icon">${iconSvg}</div>
        <div class="notification-message">${message}</div>
        <button class="notification-close" onclick="this.parentElement.remove()">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
        </button>
    `;
    
    // Style notification
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        padding: 15px 20px;
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
        display: flex;
        align-items: center;
        gap: 12px;
        z-index: 10000;
        max-width: 400px;
        border: 1px solid rgba(255, 255, 255, 0.3);
        animation: slideInRight 0.4s ease;
        font-family: 'Plus Jakarta Sans', sans-serif;
    `;
    
    // Tambahkan ke body
    document.body.appendChild(notification);
    
    // Auto-hide setelah 4 detik
    setTimeout(() => {
        if (notification.parentElement) {
            notification.style.animation = 'slideOutRight 0.4s ease forwards';
            setTimeout(() => notification.remove(), 400);
        }
    }, 4000);
    
    // Tambahkan keyframes untuk animasi
    if (!document.getElementById('notification-styles')) {
        const styleSheet = document.createElement('style');
        styleSheet.id = 'notification-styles';
        styleSheet.textContent = `
            @keyframes slideInRight {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            @keyframes slideOutRight {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(100%);
                    opacity: 0;
                }
            }
            .notification-icon {
                flex-shrink: 0;
            }
            .notification-icon svg {
                width: 24px;
                height: 24px;
            }
            .notification-message {
                font-size: 14px;
                color: #374151;
                flex: 1;
            }
            .notification-close {
                background: none;
                border: none;
                cursor: pointer;
                padding: 4px;
                color: #9ca3af;
                display: flex;
                align-items: center;
                transition: color 0.2s;
                flex-shrink: 0;
            }
            .notification-close:hover {
                color: #E5484D;
            }
            .notification-close svg {
                width: 16px;
                height: 16px;
            }
            .loading-dots {
                display: inline-flex;
                gap: 3px;
                margin-right: 8px;
            }
            .loading-dots span {
                animation: loadingDot 1.4s infinite;
                font-size: 20px;
            }
            .loading-dots span:nth-child(2) {
                animation-delay: 0.2s;
            }
            .loading-dots span:nth-child(3) {
                animation-delay: 0.4s;
            }
            @keyframes loadingDot {
                0%, 100% { opacity: 0.3; }
                50% { opacity: 1; }
            }
        `;
        document.head.appendChild(styleSheet);
    }
}

/* ========================================= */
/* SET CURRENT YEAR UNTUK FOOTER */
/* ========================================= */

/**
 * Menampilkan tahun saat ini di footer copyright
 */
function initCurrentYear() {
    const yearElement = document.getElementById('currentYear');
    if (yearElement) {
        yearElement.textContent = new Date().getFullYear();
    }
}

/* ========================================= */
/* CONSOLE LOGO UNTUK BRANDING */
/* ========================================= */

/**
 * Menampilkan logo di console untuk branding
 */
console.log(
    '%c PT. JUARA Mail ',
    'background: linear-gradient(135deg, #2F6FEE, #081527); color: white; font-size: 24px; font-weight: bold; padding: 10px 20px; border-radius: 8px;'
);
console.log(
    '%c Portal Email Perusahaan - Pejuang Devisa Negara ',
    'color: #2F6FEE; font-size: 14px; font-weight: 500;'
);
console.log(
    '%c © ' + new Date().getFullYear() + ' PT. JUARA. All Rights Reserved.',
    'color: #5A6B82; font-size: 12px;'
);