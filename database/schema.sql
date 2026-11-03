CREATE DATABASE IF NOT EXISTS xep_hang_app
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE xep_hang_app;

-- Danh sach ung dung lay tu CMS
CREATE TABLE IF NOT EXISTS ung_dung (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ma_cms VARCHAR(255) NULL,
  ten VARCHAR(500) NOT NULL,
  id_google VARCHAR(255) NULL,
  id_apple VARCHAR(64) NULL,
  goi_apple VARCHAR(255) NULL,
  tu_khoa JSON NULL,
  du_lieu_cms JSON NULL,
  kich_hoat TINYINT(1) NOT NULL DEFAULT 1,
  tao_luc TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sua_luc TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ud_google (id_google),
  UNIQUE KEY uq_ud_apple (id_apple),
  KEY idx_ud_ten (ten(191)),
  KEY idx_ud_kich_hoat (kich_hoat)
) ENGINE=InnoDB;

-- Cac quoc gia/cua hang duoc kiem tra
CREATE TABLE IF NOT EXISTS quoc_gia (
  ma CHAR(2) NOT NULL PRIMARY KEY,
  ten VARCHAR(100) NOT NULL,
  ma_vi_tri_google INT NOT NULL,
  ma_cua_hang_apple CHAR(2) NOT NULL,
  ngon_ngu VARCHAR(10) NOT NULL DEFAULT 'en',
  kich_hoat TINYINT(1) NOT NULL DEFAULT 1,
  tao_luc TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sua_luc TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Moi lan chay kiem tra thu hang
CREATE TABLE IF NOT EXISTS lan_chay (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  bat_dau DATETIME NOT NULL,
  ket_thuc DATETIME NULL,
  loai ENUM('manual','scheduled') NOT NULL DEFAULT 'manual',
  trang_thai ENUM('running','completed','partial','failed') NOT NULL DEFAULT 'running',
  so_ung_dung INT NOT NULL DEFAULT 0,
  so_lan_kiem INT NOT NULL DEFAULT 0,
  loi TEXT NULL,
  tao_luc TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_lc_bat_dau (bat_dau),
  KEY idx_lc_trang_thai (trang_thai)
) ENGINE=InnoDB;

-- Ket qua tim kiem va vi tri ung dung tren store
CREATE TABLE IF NOT EXISTS thu_hang (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  lan_id BIGINT UNSIGNED NULL,
  ung_dung_id BIGINT UNSIGNED NOT NULL,
  nen_tang ENUM('google_play','app_store') NOT NULL,
  ma_quoc_gia CHAR(2) NOT NULL,
  tu_khoa VARCHAR(500) NOT NULL,
  vi_tri INT NULL,
  trang_thai ENUM('found','not_found','provider_error','provider_not_configured','invalid_app_id') NOT NULL,
  do_sau INT NOT NULL DEFAULT 200,
  id_store VARCHAR(255) NULL,
  ten_store VARCHAR(500) NULL,
  url_store TEXT NULL,
  nha_cc VARCHAR(100) NOT NULL,
  ma_tac_vu VARCHAR(255) NULL,
  loi TEXT NULL,
  kiem_tra_luc DATETIME NOT NULL,
  phan_hoi JSON NULL,
  tao_luc TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_th_ud FOREIGN KEY (ung_dung_id) REFERENCES ung_dung(id),
  CONSTRAINT fk_th_lan FOREIGN KEY (lan_id) REFERENCES lan_chay(id) ON DELETE SET NULL,
  KEY idx_th_tra_cuu (ung_dung_id, nen_tang, ma_quoc_gia, tu_khoa(191), kiem_tra_luc),
  KEY idx_th_quoc_gia (ma_quoc_gia, nen_tang, kiem_tra_luc),
  KEY idx_th_trang_thai (trang_thai, kiem_tra_luc)
) ENGINE=InnoDB;
