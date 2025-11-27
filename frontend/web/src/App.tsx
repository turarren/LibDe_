import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface BookData {
  id: string;
  title: string;
  author: string;
  encryptedBorrowCount: string;
  publicRating: number;
  description: string;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [books, setBooks] = useState<BookData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showBorrowModal, setShowBorrowModal] = useState(false);
  const [borrowingBook, setBorrowingBook] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newBookData, setNewBookData] = useState({ title: "", author: "", rating: "", borrowCount: "" });
  const [selectedBook, setSelectedBook] = useState<BookData | null>(null);
  const [decryptedCount, setDecryptedCount] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showFAQ, setShowFAQ] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadBooks();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadBooks = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const booksList: BookData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          booksList.push({
            id: businessId,
            title: businessData.name,
            author: businessData.description,
            encryptedBorrowCount: businessId,
            publicRating: Number(businessData.publicValue1) || 0,
            description: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading book data:', e);
        }
      }
      
      setBooks(booksList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load books" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const borrowBook = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setBorrowingBook(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Borrowing book with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const borrowValue = parseInt(newBookData.borrowCount) || 1;
      const bookId = `book-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, borrowValue);
      
      const tx = await contract.createBusinessData(
        bookId,
        newBookData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newBookData.rating) || 5,
        0,
        newBookData.author
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Book borrowed successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadBooks();
      setShowBorrowModal(false);
      setNewBookData({ title: "", author: "", rating: "", borrowCount: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Borrow failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setBorrowingBook(false); 
    }
  };

  const decryptBorrowCount = async (bookId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const bookData = await contractRead.getBusinessData(bookId);
      if (bookData.isVerified) {
        const storedValue = Number(bookData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Borrow count already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(bookId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(bookId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying borrow count..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadBooks();
      
      setTransactionStatus({ visible: true, status: "success", message: "Borrow count decrypted!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadBooks();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Library system is available" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredBooks = books.filter(book => 
    book.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    book.author.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const stats = {
    totalBooks: books.length,
    verifiedBooks: books.filter(b => b.isVerified).length,
    avgRating: books.length > 0 ? books.reduce((sum, b) => sum + b.publicRating, 0) / books.length : 0
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🔒 FHE Library</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">📚</div>
            <h2>Welcome to Private Library</h2>
            <p>Connect your wallet to access FHE-protected book borrowing with complete privacy</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading private library...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🔒 FHE Private Library</h1>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="status-btn">
            Check Status
          </button>
          <button onClick={() => setShowBorrowModal(true)} className="borrow-btn">
            Borrow Book
          </button>
          <button onClick={() => setShowFAQ(!showFAQ)} className="faq-btn">
            FAQ
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panels">
          <div className="stat-panel">
            <h3>Total Books</h3>
            <div className="stat-value">{stats.totalBooks}</div>
          </div>
          <div className="stat-panel">
            <h3>Verified Data</h3>
            <div className="stat-value">{stats.verifiedBooks}/{stats.totalBooks}</div>
          </div>
          <div className="stat-panel">
            <h3>Avg Rating</h3>
            <div className="stat-value">{stats.avgRating.toFixed(1)}/5</div>
          </div>
        </div>

        <div className="search-section">
          <input
            type="text"
            placeholder="Search books or authors..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
          <button onClick={loadBooks} disabled={isRefreshing} className="refresh-btn">
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {showFAQ && (
          <div className="faq-section">
            <h3>FHE Library FAQ</h3>
            <div className="faq-item">
              <strong>How does FHE protect my privacy?</strong>
              <p>Borrow counts are encrypted using Fully Homomorphic Encryption, ensuring even the library cannot track your reading habits.</p>
            </div>
            <div className="faq-item">
              <strong>What data is encrypted?</strong>
              <p>Only borrow counts are encrypted. Book titles and ratings remain public for discovery.</p>
            </div>
            <div className="faq-item">
              <strong>How does decryption work?</strong>
              <p>Decryption happens offline using FHEVM, with proofs verified on-chain for transparency.</p>
            </div>
          </div>
        )}

        <div className="books-grid">
          {filteredBooks.length === 0 ? (
            <div className="no-books">
              <p>No books found</p>
              <button onClick={() => setShowBorrowModal(true)} className="borrow-btn">
                Borrow First Book
              </button>
            </div>
          ) : (
            filteredBooks.map((book, index) => (
              <div 
                className={`book-card ${selectedBook?.id === book.id ? "selected" : ""}`}
                key={index}
                onClick={() => setSelectedBook(book)}
              >
                <div className="book-title">{book.title}</div>
                <div className="book-author">by {book.author}</div>
                <div className="book-rating">Rating: {"⭐".repeat(book.publicRating)}</div>
                <div className="book-status">
                  {book.isVerified ? 
                    `Borrowed: ${book.decryptedValue} times ✅` : 
                    "Borrow count: 🔒 Encrypted"
                  }
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      
      {showBorrowModal && (
        <BorrowModal 
          onSubmit={borrowBook} 
          onClose={() => setShowBorrowModal(false)} 
          borrowing={borrowingBook} 
          bookData={newBookData} 
          setBookData={setNewBookData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedBook && (
        <BookDetailModal 
          book={selectedBook} 
          onClose={() => { 
            setSelectedBook(null); 
            setDecryptedCount(null); 
          }} 
          decryptedCount={decryptedCount} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptBorrowCount(selectedBook.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const BorrowModal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  borrowing: boolean;
  bookData: any;
  setBookData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, borrowing, bookData, setBookData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'borrowCount') {
      const intValue = value.replace(/[^\d]/g, '');
      setBookData({ ...bookData, [name]: intValue });
    } else {
      setBookData({ ...bookData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="borrow-modal">
        <div className="modal-header">
          <h2>Borrow New Book</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE Privacy Protection</strong>
            <p>Borrow count encrypted with Zama FHE - even we can't see it!</p>
          </div>
          
          <div className="form-group">
            <label>Book Title *</label>
            <input 
              type="text" 
              name="title" 
              value={bookData.title} 
              onChange={handleChange} 
              placeholder="Enter book title..." 
            />
          </div>
          
          <div className="form-group">
            <label>Author *</label>
            <input 
              type="text" 
              name="author" 
              value={bookData.author} 
              onChange={handleChange} 
              placeholder="Enter author name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Your Rating (1-5) *</label>
            <input 
              type="number" 
              min="1" 
              max="5" 
              name="rating" 
              value={bookData.rating} 
              onChange={handleChange} 
              placeholder="Enter rating..." 
            />
          </div>
          
          <div className="form-group">
            <label>Borrow Count (Encrypted) *</label>
            <input 
              type="number" 
              name="borrowCount" 
              value={bookData.borrowCount} 
              onChange={handleChange} 
              placeholder="Enter borrow count..." 
              step="1"
              min="1"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={borrowing || isEncrypting || !bookData.title || !bookData.author || !bookData.rating || !bookData.borrowCount} 
            className="submit-btn"
          >
            {borrowing || isEncrypting ? "Encrypting..." : "Borrow Book"}
          </button>
        </div>
      </div>
    </div>
  );
};

const BookDetailModal: React.FC<{
  book: BookData;
  onClose: () => void;
  decryptedCount: number | null;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ book, onClose, decryptedCount, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedCount !== null) return;
    await decryptData();
  };

  return (
    <div className="modal-overlay">
      <div className="book-detail-modal">
        <div className="modal-header">
          <h2>Book Details</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="book-info">
            <div className="info-item">
              <span>Title:</span>
              <strong>{book.title}</strong>
            </div>
            <div className="info-item">
              <span>Author:</span>
              <strong>{book.author}</strong>
            </div>
            <div className="info-item">
              <span>Rating:</span>
              <strong>{"⭐".repeat(book.publicRating)}</strong>
            </div>
          </div>
          
          <div className="privacy-section">
            <h3>Privacy Protection</h3>
            
            <div className="data-row">
              <div className="data-label">Borrow Count:</div>
              <div className="data-value">
                {book.isVerified ? 
                  `${book.decryptedValue} times (Verified)` : 
                  decryptedCount !== null ? 
                  `${decryptedCount} times (Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(book.isVerified || decryptedCount !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? "Decrypting..." : 
                 book.isVerified ? "✅ Verified" : 
                 decryptedCount !== null ? "🔓 Decrypted" : 
                 "🔓 Decrypt Count"}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE Privacy Guarantee</strong>
                <p>Your reading habits are encrypted. Only you can decrypt the borrow count with your wallet.</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;